import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { prisma } from '../src/lib/prisma.js';
import { InMemoryMailer, resetDatabase } from './helpers.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('health probes', () => {
    it('reports liveness', async () => {
        const res = await request(createApp({ mailer: new InMemoryMailer() })).get('/health').expect(200);
        expect(res.body.status).toBe('ok');
    });

    it('reports ready when the database is reachable', async () => {
        const res = await request(createApp({ mailer: new InMemoryMailer() })).get('/ready').expect(200);
        expect(res.body.checks).toEqual({ database: 'ok', signingKeys: 'ok' });
    });

    it('reports not ready while shutting down', async () => {
        const app = createApp({ mailer: new InMemoryMailer(), health: { shuttingDown: true } });
        await request(app).get('/ready').expect(503);
    });

    it('reports not ready when the database is down', async () => {
        const unreachable = { $queryRaw: () => Promise.reject(new Error('connection refused')) } as unknown as PrismaClient;
        const res = await request(createApp({ mailer: new InMemoryMailer(), db: unreachable })).get('/ready').expect(503);
        expect(res.body.checks.database).toBe('error');
    });
});
