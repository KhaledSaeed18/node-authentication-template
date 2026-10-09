import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import type { MailContent, Mailer } from '../src/mail/mailer.js';
import { API, InMemoryMailer, resetDatabase, strongPassword } from './helpers.js';

const mailer = new InMemoryMailer();
const app = createApp({ mailer });
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
        const code = mailer.lastCode(email);

        const [record] = await prisma.verificationCode.findMany();
        expect(record.codeHash).not.toContain(code);
        expect(record.codeHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('can only be used once', async () => {
        await signup().expect(201);
        const code = mailer.lastCode(email);

        await request(app).post(`${auth}/verify-email`).send({ email, code }).expect(200);
        await request(app).post(`${auth}/verify-email`).send({ email, code }).expect(400);
    });

    it('is discarded after 5 wrong attempts, even if the right code comes next', async () => {
        await signup().expect(201);
        const code = mailer.lastCode(email);

        for (let i = 0; i < 5; i++) {
            await request(app).post(`${auth}/verify-email`).send({ email, code: wrongCode(code) }).expect(400);
        }
        await request(app).post(`${auth}/verify-email`).send({ email, code }).expect(400);
    });

    it('limits parallel guessing to 5 checks', async () => {
        await signup().expect(201);
        const code = mailer.lastCode(email);

        const guesses = Array.from({ length: 20 }, () =>
            request(app).post(`${auth}/verify-email`).send({ email, code: wrongCode(code) })
        );
        await Promise.all(guesses);

        await request(app).post(`${auth}/verify-email`).send({ email, code }).expect(400);
    });

    it('enforces a cooldown between codes', async () => {
        await signup().expect(201);

        const res = await request(app).post(`${auth}/resend-verification`).send({ email }).expect(429);
        expect(res.body.code).toBe('CODE_COOLDOWN');
    });

    it('still creates the account when the email cannot be sent', async () => {
        const failingMailer: Mailer = {
            send: async (_to: string, _content: MailContent) => {
                throw new Error('SMTP down');
            },
        };

        await signup(createApp({ mailer: failingMailer })).expect(201);
        expect(await prisma.user.count({ where: { email } })).toBe(1);
    });
});
