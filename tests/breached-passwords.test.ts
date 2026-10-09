import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { type BreachedPasswordChecker, PwnedPasswordsChecker } from '../src/shared/utils/breached-passwords.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, createTestApp, resetDatabase, strongPassword } from './helpers.js';

const BREACHED = 'Pwn3d$Password';
const fakeChecker: BreachedPasswordChecker = { isBreached: async (password) => password === BREACHED };
const { app, mailer } = createTestApp({ breachedPasswords: fakeChecker });

beforeEach(async () => {
    mailer.clear();
    await resetDatabase();
});
afterAll(() => prisma.$disconnect());

describe('breached passwords are refused', () => {
    it('at signup, with a field error', async () => {
        const res = await request(app)
            .post(`${API}/auth/signup`)
            .send({ firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.io', password: BREACHED })
            .expect(400);
        expect(res.body.validationErrors).toEqual([{ field: 'password', message: expect.stringContaining('data breach') }]);
        expect(await prisma.user.count()).toBe(0);
    });

    it('at password reset, without burning the code', async () => {
        await prisma.user.create({
            data: { firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.io', password: await hashPassword(strongPassword), isVerified: true },
        });
        await request(app).post(`${API}/auth/forgot-password`).send({ email: 'jane@acme.io' }).expect(200);
        const code = await mailer.lastCode('jane@acme.io');

        await request(app).post(`${API}/auth/reset-password`).send({ email: 'jane@acme.io', code, newPassword: BREACHED }).expect(400);
        await request(app)
            .post(`${API}/auth/reset-password`)
            .send({ email: 'jane@acme.io', code, newPassword: 'An0ther$ecretPass' })
            .expect(200);
    });

    it('at password change', async () => {
        await prisma.user.create({
            data: { firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.io', password: await hashPassword(strongPassword), isVerified: true },
        });
        const { body } = await request(app).post(`${API}/auth/signin`).send({ email: 'jane@acme.io', password: strongPassword });

        await request(app)
            .post(`${API}/auth/change-password`)
            .set('Authorization', `Bearer ${body.data.accessToken}`)
            .send({ currentPassword: strongPassword, newPassword: BREACHED })
            .expect(400);
    });
});

describe('PwnedPasswordsChecker', () => {
    const sha1 = (value: string) => createHash('sha1').update(value).digest('hex').toUpperCase();

    const fakeApi = (lines: (hash: string) => string[]) => {
        const calls: { url: string; headers: Record<string, string> }[] = [];
        const fetchFn = (async (url: string, init: RequestInit) => {
            calls.push({ url, headers: init.headers as Record<string, string> });
            return new Response(lines(sha1('hunter2')).join('\r\n'));
        }) as unknown as typeof fetch;
        return { calls, fetchFn };
    };

    it('only sends the first 5 characters of the hash, asks for padding, and matches the suffix', async () => {
        const { calls, fetchFn } = fakeApi((hash) => ['0018A45C4D1DEF81644B54AB7F969B88D65:3', `${hash.slice(5)}:24230577`]);
        const checker = new PwnedPasswordsChecker(2000, fetchFn);

        expect(await checker.isBreached('hunter2')).toBe(true);
        expect(calls[0].url).toBe(`https://api.pwnedpasswords.com/range/${sha1('hunter2').slice(0, 5)}`);
        expect(calls[0].url).not.toContain(sha1('hunter2').slice(5));
        expect(calls[0].headers['Add-Padding']).toBe('true');
    });

    it('ignores padding entries (count 0)', async () => {
        const { fetchFn } = fakeApi((hash) => [`${hash.slice(5)}:0`]);
        expect(await new PwnedPasswordsChecker(2000, fetchFn).isBreached('hunter2')).toBe(false);
    });

    it('fails open when the API is down or slow', async () => {
        const failing = (async () => {
            throw new Error('network down');
        }) as unknown as typeof fetch;
        expect(await new PwnedPasswordsChecker(2000, failing).isBreached('hunter2')).toBe(false);

        const slow = ((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
        expect(await new PwnedPasswordsChecker(50, slow).isBreached('hunter2')).toBe(false);
    });
});
