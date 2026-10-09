import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { enqueue, type OutboxHandlers } from '../src/modules/outbox/outbox.js';
import { OutboxWorker, retryDelayMs } from '../src/modules/outbox/outbox.worker.js';
import { eventually, resetDatabase } from './helpers.js';

// Test handlers only use one job type; the rest of the map is irrelevant here
const handlersFor = (handler: (payload: { email: string }, context: { attempt: number }) => Promise<void>) =>
    ({ 'email.verification': handler }) as unknown as OutboxHandlers;

const job = (id: string) => prisma.outboxMessage.findUniqueOrThrow({ where: { id } });
const onlyJob = async () => (await prisma.outboxMessage.findMany())[0];
const makeDue = () => prisma.outboxMessage.updateMany({ data: { availableAt: new Date(Date.now() - 1000) } });

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('outbox worker', () => {
    it('delivers a job and marks it done', async () => {
        const received: string[] = [];
        const worker = new OutboxWorker(prisma, handlersFor(async ({ email }) => void received.push(email)));

        await enqueue(prisma, 'email.verification', { email: 'jane@acme.io' });
        await worker.drain();

        expect(received).toEqual(['jane@acme.io']);
        expect(await onlyJob()).toMatchObject({ status: 'DONE', attempts: 1, lastError: null });
    });

    it('retries failed jobs later and gives up after the maximum attempts', async () => {
        const attempts: number[] = [];
        const worker = new OutboxWorker(
            prisma,
            handlersFor(async (_payload, { attempt }) => {
                attempts.push(attempt);
                throw new Error('provider unavailable');
            }),
            { maxAttempts: 3 }
        );
        await enqueue(prisma, 'email.verification', { email: 'jane@acme.io' });

        await worker.drain();
        const afterFirst = await onlyJob();
        expect(afterFirst).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'provider unavailable' });
        expect(afterFirst.availableAt.getTime()).toBeGreaterThan(Date.now());

        // Not due yet, so draining again does nothing
        await worker.drain();
        expect(attempts).toEqual([1]);

        await makeDue();
        await worker.drain();
        await makeDue();
        await worker.drain();

        expect(attempts).toEqual([1, 2, 3]);
        expect(await onlyJob()).toMatchObject({ status: 'FAILED', attempts: 3 });
    });

    it('fails jobs without a handler right away', async () => {
        const worker = new OutboxWorker(prisma, {} as OutboxHandlers);
        await prisma.outboxMessage.create({ data: { type: 'unknown.job', payload: {} } });

        await worker.drain();

        expect(await onlyJob()).toMatchObject({ status: 'FAILED', lastError: 'No handler registered for job type "unknown.job"' });
    });

    it('hands every job to exactly one of several concurrent workers', async () => {
        const handled = new Map<string, number>();
        const handler = async ({ email }: { email: string }) => {
            handled.set(email, (handled.get(email) ?? 0) + 1);
            await new Promise((resolve) => setTimeout(resolve, 5));
        };
        const workers = Array.from({ length: 3 }, () => new OutboxWorker(prisma, handlersFor(handler), { batchSize: 4 }));

        for (let i = 0; i < 30; i++) await enqueue(prisma, 'email.verification', { email: `user${i}@acme.io` });
        await Promise.all(workers.map((worker) => worker.drain()));

        expect(handled.size).toBe(30);
        expect([...handled.values()].every((count) => count === 1)).toBe(true);
        expect(await prisma.outboxMessage.count({ where: { status: 'DONE' } })).toBe(30);
    });

    it('picks up jobs abandoned by a crashed worker', async () => {
        const received: string[] = [];
        const worker = new OutboxWorker(prisma, handlersFor(async ({ email }) => void received.push(email)), {
            lockTimeoutMs: 60_000,
        });
        const { id } = await prisma.outboxMessage.create({
            data: {
                type: 'email.verification',
                payload: { email: 'jane@acme.io' },
                status: 'PROCESSING',
                attempts: 1,
                lockedAt: new Date(Date.now() - 10 * 60 * 1000),
            },
        });

        await worker.drain();

        expect(received).toEqual(['jane@acme.io']);
        expect(await job(id)).toMatchObject({ status: 'DONE', attempts: 2 });
    });

    it('leaves jobs that another worker is still processing alone', async () => {
        const worker = new OutboxWorker(prisma, handlersFor(async () => {}), { lockTimeoutMs: 60_000 });
        const { id } = await prisma.outboxMessage.create({
            data: { type: 'email.verification', payload: { email: 'jane@acme.io' }, status: 'PROCESSING', lockedAt: new Date() },
        });

        await worker.drain();

        expect(await job(id)).toMatchObject({ status: 'PROCESSING' });
    });

    it('runs in the background once started', async () => {
        const received: string[] = [];
        const worker = new OutboxWorker(prisma, handlersFor(async ({ email }) => void received.push(email)), {
            pollIntervalMs: 50,
        });

        worker.start();
        await enqueue(prisma, 'email.verification', { email: 'jane@acme.io' });
        await eventually(() => expect(received).toEqual(['jane@acme.io']));
        await worker.stop();
    });
});

describe('enqueue', () => {
    it('is rolled back with the transaction it belongs to', async () => {
        await expect(
            prisma.$transaction(async (tx) => {
                await enqueue(tx, 'email.verification', { email: 'jane@acme.io' });
                throw new Error('the change failed');
            })
        ).rejects.toThrow('the change failed');

        expect(await prisma.outboxMessage.count()).toBe(0);
    });

    it('can delay a job', async () => {
        await enqueue(prisma, 'email.verification', { email: 'jane@acme.io' }, { delayMs: 60_000 });
        expect((await onlyJob()).availableAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    });
});

describe('retryDelayMs', () => {
    it('backs off exponentially with a cap', () => {
        expect(retryDelayMs(1)).toBeGreaterThanOrEqual(10_000);
        expect(retryDelayMs(1)).toBeLessThanOrEqual(12_000);
        expect(retryDelayMs(3)).toBeGreaterThanOrEqual(40_000);
        expect(retryDelayMs(20)).toBeLessThanOrEqual(15 * 60 * 1000 * 1.2);
    });
});
