import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import type { MailContent, Mailer } from '../src/mail/mailer.js';
import { API, createTestApp, resetDatabase, strongPassword } from './helpers.js';

const { app, mailer, worker } = createTestApp();
const auth = `${API}/auth`;
const email = 'jane@acme.io';

const signup = (agent = app) =>
    request(agent).post(`${auth}/signup`).send({ firstName: 'Jane', lastName: 'Doe', email, password: strongPassword });

const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

beforeEach(async () => {
    mailer.clear();
    await resetDatabase();
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('one-time codes', () => {
    it('stores only a hash of the code', async () => {
        await signup().expect(201);
        const code = await mailer.lastCode(email);

        const [record] = await prisma.verificationCode.findMany();
        expect(record.codeHash).not.toContain(code);
        expect(record.codeHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('can only be used once', async () => {
        await signup().expect(201);
        const code = await mailer.lastCode(email);

        await request(app).post(`${auth}/verify-email`).send({ email, code }).expect(200);
        await request(app).post(`${auth}/verify-email`).send({ email, code }).expect(400);
    });

    it('is discarded after 5 wrong attempts, even if the right code comes next', async () => {
        await signup().expect(201);
        const code = await mailer.lastCode(email);

        for (let i = 0; i < 5; i++) {
            await request(app).post(`${auth}/verify-email`).send({ email, code: wrongCode(code) }).expect(400);
        }
        await request(app).post(`${auth}/verify-email`).send({ email, code }).expect(400);
    });

    it('limits parallel guessing to 5 checks', async () => {
        await signup().expect(201);
        const code = await mailer.lastCode(email);

        const guesses = Array.from({ length: 20 }, () =>
            request(app).post(`${auth}/verify-email`).send({ email, code: wrongCode(code) })
        );
        await Promise.all(guesses);

        await request(app).post(`${auth}/verify-email`).send({ email, code }).expect(400);
    });

    it('does not send a new code during the cooldown, without telling the client', async () => {
        await signup().expect(201);

        await worker.drain();
        await request(app).post(`${auth}/resend-verification`).send({ email }).expect(200);
        await worker.drain();
        expect(mailer.sent).toHaveLength(1);
    });

    it('keeps the email for a retry when the mail provider is down', async () => {
        const failingMailer: Mailer = {
            send: async (_to: string, _content: MailContent) => {
                throw new Error('SMTP down');
            },
        };
        const failing = createTestApp({ mailer: failingMailer });

        await signup(failing.app).expect(201);
        await failing.worker.drain();

        expect(await prisma.user.count({ where: { email } })).toBe(1);
        const [job] = await prisma.outboxMessage.findMany();
        expect(job).toMatchObject({ type: 'email.verification', status: 'PENDING', attempts: 1, lastError: 'SMTP down' });
        expect(job.availableAt.getTime()).toBeGreaterThan(Date.now());
    });
});

describe('account enumeration', () => {
    it('answers forgot-password the same way for unknown emails', async () => {
        await signup().expect(201);

        const known = await request(app).post(`${auth}/forgot-password`).send({ email }).expect(200);
        const unknown = await request(app).post(`${auth}/forgot-password`).send({ email: 'nobody@acme.io' }).expect(200);

        expect(unknown.body).toEqual(known.body);
        await worker.drain();
        expect(mailer.sent.some((m) => m.to === email && m.content.subject.includes('Reset'))).toBe(true);
        expect(mailer.sent.some((m) => m.to === 'nobody@acme.io')).toBe(false);
    });

    it('answers resend-verification the same way for unknown emails', async () => {
        const known = await request(app).post(`${auth}/resend-verification`).send({ email }).expect(200);
        const unknown = await request(app).post(`${auth}/resend-verification`).send({ email: 'nobody@acme.io' }).expect(200);

        expect(unknown.body).toEqual(known.body);
    });

    it('gives the same error for an unknown email and a wrong code', async () => {
        await signup().expect(201);
        const code = await mailer.lastCode(email);

        const wrong = await request(app).post(`${auth}/verify-email`).send({ email, code: wrongCode(code) }).expect(400);
        const unknown = await request(app)
            .post(`${auth}/verify-email`)
            .send({ email: 'nobody@acme.io', code })
            .expect(400);
        expect(unknown.body).toEqual(wrong.body);

        const reset = await request(app)
            .post(`${auth}/reset-password`)
            .send({ email: 'nobody@acme.io', code, newPassword: 'An0ther$ecretPass' })
            .expect(400);
        expect(reset.body.code).toBe('INVALID_CODE');
    });
});

