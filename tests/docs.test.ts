import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { InMemoryMailer } from './helpers.js';

const app = createApp({ mailer: new InMemoryMailer() });
afterAll(() => prisma.$disconnect());

describe('API docs', () => {
    it('serves an OpenAPI 3.1 document covering every route', async () => {
        const res = await request(app).get('/docs/openapi.json').expect(200);

        expect(res.body.openapi).toBe('3.1.0');
        expect(res.body.info.version).toBe('3.0.0');
        expect(Object.keys(res.body.paths)).toHaveLength(28);
        expect(res.body.paths['/auth/signin'].post.requestBody).toBeDefined();
        expect(res.body.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    });

    it('serves the interactive reference', async () => {
        const res = await request(app).get('/docs').expect(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
    });
});
