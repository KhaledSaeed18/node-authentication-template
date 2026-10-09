import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, InMemoryMailer, resetDatabase, strongPassword } from './helpers.js';

const app = createApp({ mailer: new InMemoryMailer() });
const email = 'jane@acme.io';

const signin = (password: string, as = email) =>
    request(app).post(`${API}/auth/signin`).send({ email: as, password });

beforeEach(async () => {
    await resetDatabase();
    await prisma.user.create({
        data: { firstName: 'Jane', lastName: 'Doe', email, password: await hashPassword(strongPassword), isVerified: true },
    });
});

afterAll(() => prisma.$disconnect());

describe('account lockout', () => {
    it('locks the account after 5 failed attempts, even with the right password', async () => {
        for (let i = 0; i < 5; i++) await signin('Wr0ng$Password').expect(401);

        const res = await signin(strongPassword).expect(429);
        expect(res.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('resets the counter after a successful signin', async () => {
        for (let i = 0; i < 4; i++) await signin('Wr0ng$Password').expect(401);
        await signin(strongPassword).expect(200);

        for (let i = 0; i < 4; i++) await signin('Wr0ng$Password').expect(401);
        await signin(strongPassword).expect(200);
    });

    it('unlocks once the failures are older than the lockout window', async () => {
        for (let i = 0; i < 5; i++) await signin('Wr0ng$Password').expect(401);
        await prisma.loginHistory.updateMany({ data: { loginTime: new Date(Date.now() - 16 * 60 * 1000) } });

        await signin(strongPassword).expect(200);
    });
});

describe('timing', () => {
    it('takes about as long for an unknown email as for a wrong password', async () => {
        const time = async (fn: () => Promise<unknown>) => {
            const start = performance.now();
            await fn();
            return performance.now() - start;
        };

        await signin('warm-up', 'nobody@acme.io');
        const unknown = await time(() => signin('Wr0ng$Password', 'nobody@acme.io'));
        const wrong = await time(() => signin('Wr0ng$Password'));

        // An unknown account must still pay for a password hash check
        expect(unknown).toBeGreaterThan(wrong * 0.4);
    });
});
