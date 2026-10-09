import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, createTestApp, resetDatabase, strongPassword } from './helpers.js';

// Collects on demand instead of on a timer
class TestReader extends MetricReader {
    protected async onForceFlush() {}
    protected async onShutdown() {}
}

const reader = new TestReader();
const { app, worker } = createTestApp();

const points = async (name: string) => {
    const { resourceMetrics } = await reader.collect();
    const metric = resourceMetrics.scopeMetrics.flatMap((s) => s.metrics).find((m) => m.descriptor.name === name);
    return (metric?.dataPoints ?? []).map((p) => ({ attributes: p.attributes, value: p.value }));
};

beforeAll(() => {
    metrics.disable();
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
});

beforeEach(resetDatabase);

afterAll(async () => {
    metrics.disable();
    await prisma.$disconnect();
});

describe('business metrics', () => {
    it('counts sign-ins by method and result, and delivered outbox jobs', async () => {
        await prisma.user.create({
            data: { firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.io', password: await hashPassword(strongPassword), isVerified: true },
        });

        await request(app).post(`${API}/auth/signin`).send({ email: 'jane@acme.io', password: 'Wr0ng$Password' }).expect(401);
        await request(app).post(`${API}/auth/signin`).send({ email: 'nobody@acme.io', password: 'Wr0ng$Password' }).expect(401);
        await request(app).post(`${API}/auth/signin`).send({ email: 'jane@acme.io', password: strongPassword }).expect(200);
        await request(app).post(`${API}/auth/forgot-password`).send({ email: 'jane@acme.io' }).expect(200);
        await worker.drain();

        expect(await points('auth.signin.attempts')).toEqual(
            expect.arrayContaining([
                { attributes: { method: 'password', result: 'failure' }, value: 2 },
                { attributes: { method: 'password', result: 'success' }, value: 1 },
            ])
        );
        expect(await points('outbox.jobs.processed')).toEqual(
            expect.arrayContaining([{ attributes: { type: 'email.password-reset', outcome: 'done' }, value: 1 }])
        );
    });
});
