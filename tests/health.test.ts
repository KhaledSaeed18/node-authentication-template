import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { InMemoryMailer } from './helpers.js';

afterAll(() => prisma.$disconnect());

describe('health probes', () => {
    it('reports liveness', async () => {
        const res = await request(createApp({ mailer: new InMemoryMailer() })).get('/health').expect(200);
        expect(res.body.status).toBe('ok');
    });

    it('reports ready when the database is reachable', async () => {
        const res = await request(createApp({ mailer: new InMemoryMailer() })).get('/ready').expect(200);
        expect(res.body.checks.database).toBe('ok');
    });

    it('reports not ready while shutting down', async () => {
        const app = createApp({ mailer: new InMemoryMailer(), health: { shuttingDown: true } });
        await request(app).get('/ready').expect(503);
    });
});
