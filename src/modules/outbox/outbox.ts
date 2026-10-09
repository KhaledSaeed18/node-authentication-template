import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

// Job types and their payloads. Modules add their own jobs through declaration
// merging, which keeps enqueue() and the handlers type-checked end to end:
//
//   declare module '../outbox/outbox.js' {
//       interface OutboxJobs { 'email.welcome': { userId: string } }
//   }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OutboxJobs {}

export type OutboxJobType = keyof OutboxJobs;

export interface JobContext {
    // 1 on the first try
    attempt: number;
}

export type OutboxHandlers = {
    [K in OutboxJobType]: (payload: OutboxJobs[K], context: JobContext) => Promise<void>;
};

// Accepts the regular client or the one inside $transaction(), so a job can be
// written in the same transaction as the change it belongs to
type DbClient = PrismaClient | Prisma.TransactionClient;

export const enqueue = async <T extends OutboxJobType>(
    db: DbClient,
    type: T,
    payload: OutboxJobs[T],
    { delayMs = 0 }: { delayMs?: number } = {}
): Promise<void> => {
    await db.outboxMessage.create({
        data: {
            type,
            payload: payload as unknown as Prisma.InputJsonValue,
            availableAt: new Date(Date.now() + delayMs),
        },
    });
};
