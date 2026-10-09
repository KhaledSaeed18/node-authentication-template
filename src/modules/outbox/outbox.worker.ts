import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { logger } from '../../lib/logger.js';
import { recordOutboxJob } from '../../lib/metrics.js';
import type { OutboxHandlers } from './outbox.js';

export interface OutboxWorkerOptions {
    batchSize?: number;
    pollIntervalMs?: number;
    maxAttempts?: number;
    // A PROCESSING job older than this is assumed abandoned (worker crashed) and retried
    lockTimeoutMs?: number;
}

interface ClaimedJob {
    id: string;
    type: string;
    payload: unknown;
    attempts: number;
}

const MAX_BACKOFF_MS = 15 * 60 * 1000;

// 10s, 20s, 40s, ... capped at 15 minutes, with up to 20% jitter so failed jobs don't retry in lockstep
export const retryDelayMs = (attempt: number): number => {
    const base = Math.min(10_000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    return Math.round(base * (1 + Math.random() * 0.2));
};

// Delivers outbox jobs. Any number of workers can run at once (in the API process
// or as separate processes): jobs are claimed with FOR UPDATE SKIP LOCKED, so each
// one is handed to a single worker.
export class OutboxWorker {
    private readonly batchSize: number;
    private readonly pollIntervalMs: number;
    private readonly maxAttempts: number;
    private readonly lockTimeoutMs: number;

    private running = false;
    private timer: NodeJS.Timeout | undefined;
    private currentTick: Promise<void> | undefined;

    constructor(
        private readonly db: PrismaClient,
        private readonly handlers: OutboxHandlers,
        options: OutboxWorkerOptions = {}
    ) {
        this.batchSize = options.batchSize ?? 10;
        this.pollIntervalMs = options.pollIntervalMs ?? 1000;
        this.maxAttempts = options.maxAttempts ?? 5;
        this.lockTimeoutMs = options.lockTimeoutMs ?? 5 * 60 * 1000;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.schedule(0);
        logger.info({ pollIntervalMs: this.pollIntervalMs }, 'Outbox worker started');
    }

    // Stops polling and waits for the jobs in progress to finish
    async stop(): Promise<void> {
        this.running = false;
        clearTimeout(this.timer);
        await this.currentTick;
    }

    // Processes everything that is due right now (used by scripts and tests)
    async drain(): Promise<void> {
        while ((await this.processBatch()) > 0) {
            // keep going until nothing is due
        }
    }

    // Claims and runs one batch, returns how many jobs it handled
    async processBatch(): Promise<number> {
        const jobs = await this.claim();
        await Promise.all(jobs.map((job) => this.run(job)));
        return jobs.length;
    }

    private schedule(delayMs: number) {
        this.timer = setTimeout(() => {
            this.currentTick = this.tick();
        }, delayMs);
        this.timer.unref();
    }

    private async tick() {
        let handled = 0;
        try {
            handled = await this.processBatch();
        } catch (error) {
            logger.error({ err: error }, 'Outbox worker failed to process a batch');
        }
        // A full batch probably means more is waiting, so go again right away
        if (this.running) this.schedule(handled === this.batchSize ? 0 : this.pollIntervalMs);
    }

    // Each claimed job is traced in run(); the polling query itself starts no trace
    // (see the sampler in instrumentation.ts)
    private async claim(): Promise<ClaimedJob[]> {
        const staleSeconds = Math.ceil(this.lockTimeoutMs / 1000);
        return this.db.$queryRaw<ClaimedJob[]>`
            UPDATE "OutboxMessage"
            SET "status" = 'PROCESSING', "lockedAt" = now(), "attempts" = "attempts" + 1
            WHERE "id" IN (
                SELECT "id" FROM "OutboxMessage"
                WHERE ("status" = 'PENDING' AND "availableAt" <= now())
                   OR ("status" = 'PROCESSING' AND "lockedAt" < now() - make_interval(secs => ${staleSeconds}))
                ORDER BY "availableAt"
                LIMIT ${this.batchSize}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING "id", "type", "payload", "attempts"
        `;
    }

    private run(job: ClaimedJob): Promise<void> {
        const attributes = { 'outbox.job.id': job.id, 'outbox.job.type': job.type, 'outbox.job.attempt': job.attempts };
        return trace.getTracer('node-auth').startActiveSpan(`outbox ${job.type}`, { attributes }, async (span) => {
            try {
                await this.execute(job, (error) => {
                    span.recordException(error instanceof Error ? error : String(error));
                    span.setStatus({ code: SpanStatusCode.ERROR });
                });
            } finally {
                span.end();
            }
        });
    }

    private async execute(job: ClaimedJob, onFailure: (error: unknown) => void) {
        const handler = this.handlers[job.type as keyof OutboxHandlers] as
            | ((payload: unknown, context: { attempt: number }) => Promise<void>)
            | undefined;

        try {
            if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
            await handler(job.payload, { attempt: job.attempts });

            await this.db.outboxMessage.update({
                where: { id: job.id },
                data: { status: 'DONE', processedAt: new Date(), lockedAt: null, lastError: null },
            });
            recordOutboxJob(job.type, 'done');
        } catch (error) {
            onFailure(error);
            const message = error instanceof Error ? error.message : String(error);
            const giveUp = !handler || job.attempts >= this.maxAttempts;

            await this.db.outboxMessage.update({
                where: { id: job.id },
                data: {
                    status: giveUp ? 'FAILED' : 'PENDING',
                    lockedAt: null,
                    lastError: message.slice(0, 1000),
                    ...(!giveUp && { availableAt: new Date(Date.now() + retryDelayMs(job.attempts)) }),
                },
            });

            recordOutboxJob(job.type, giveUp ? 'failed' : 'retry');
            const log = { err: error, jobId: job.id, type: job.type, attempt: job.attempts };
            if (giveUp) logger.error(log, 'Outbox job failed permanently');
            else logger.warn(log, 'Outbox job failed, will retry');
        }
    }
}
