import type { Prisma } from '../../generated/prisma/client.js';
import type { DbClient } from '../../lib/prisma.js';

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

// Pass the transaction client to write the job in the same transaction as the change
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
