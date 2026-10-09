import request from 'supertest';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { verifyPassword } from '../src/shared/utils/password.js';
import { API, InMemoryMailer, resetDatabase } from './helpers.js';

const app = createApp({ mailer: new InMemoryMailer() });
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

// Request bodies used to go through an HTML sanitizer that rewrote passwords
it('stores the password exactly as typed', async () => {
    const password = 'Tr1cky<Pass>word!';
    await request(app).post(`${API}/auth/signup`).send({ firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.io', password }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'jane@acme.io' } });
    expect((await verifyPassword(user.password, password)).valid).toBe(true);
});
