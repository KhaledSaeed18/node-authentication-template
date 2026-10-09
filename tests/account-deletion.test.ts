import { generateSync } from 'otplib';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, createTestApp, resetDatabase, strongPassword } from './helpers.js';

const { app, mailer, worker } = createTestApp();

const signedInUser = async () => {
    await prisma.user.create({
        data: { firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.io', password: await hashPassword(strongPassword), isVerified: true },
    });
    const { body } = await request(app).post(`${API}/auth/signin`).send({ email: 'jane@acme.io', password: strongPassword });
    return `Bearer ${body.data.accessToken}`;
};

beforeEach(async () => {
    mailer.clear();
    await resetDatabase();
});
afterAll(() => prisma.$disconnect());

describe('account deletion', () => {
    it('requires the current password', async () => {
        const bearer = await signedInUser();

        const res = await request(app).delete(`${API}/users/me`).set('Authorization', bearer).send({ password: 'Wr0ng$Password' }).expect(400);
        expect(res.body.code).toBe('INVALID_PASSWORD');
        expect(await prisma.user.count()).toBe(1);
    });

    it('deletes the account with everything linked to it and says goodbye', async () => {
        const bearer = await signedInUser();
        await request(app).post(`${API}/auth/signin`).send({ email: 'jane@acme.io', password: 'Wr0ng$Password' });

        await request(app).delete(`${API}/users/me`).set('Authorization', bearer).send({ password: strongPassword }).expect(200);

        expect(await prisma.user.count()).toBe(0);
        expect(await prisma.session.count()).toBe(0);
        expect(await prisma.loginHistory.count()).toBe(0);
        // The access token of the deleted account stops working at once
        await request(app).get(`${API}/users/me`).set('Authorization', bearer).expect(401);

        await worker.drain();
        expect(mailer.sent.map((m) => [m.to, m.content.subject])).toContainEqual(['jane@acme.io', 'Node Auth: your account was deleted']);
    });

    it('also requires a second factor when 2FA is on', async () => {
        const bearer = await signedInUser();
        const setup = await request(app).post(`${API}/auth/2fa/setup`).set('Authorization', bearer).expect(200);
        const { secret } = setup.body.data;
        await request(app).post(`${API}/auth/2fa/verify`).set('Authorization', bearer).send({ code: generateSync({ secret }) }).expect(200);
        await prisma.user.updateMany({ data: { totpLastUsedStep: null } });

        const missing = await request(app).delete(`${API}/users/me`).set('Authorization', bearer).send({ password: strongPassword }).expect(400);
        expect(missing.body.code).toBe('INVALID_TWO_FACTOR_CODE');

        await request(app)
            .delete(`${API}/users/me`)
            .set('Authorization', bearer)
            .send({ password: strongPassword, code: generateSync({ secret }) })
            .expect(200);
        expect(await prisma.user.count()).toBe(0);
    });
});
