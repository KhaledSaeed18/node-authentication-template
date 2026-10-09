import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, InMemoryMailer, resetDatabase, strongPassword } from './helpers.js';

const app = createApp({ mailer: new InMemoryMailer() });
const auth = `${API}/auth`;
const email = 'jane@acme.io';

const signin = async () => {
    const res = await request(app).post(`${auth}/signin`).send({ email, password: strongPassword }).expect(200);
    return res.body.data as { accessToken: string; refreshToken: string };
};

const refresh = (refreshToken: string) => request(app).post(`${auth}/refresh-token`).send({ refreshToken });

const loginHistory = (accessToken: string) =>
    request(app).get(`${auth}/login-history`).set('Authorization', `Bearer ${accessToken}`);

beforeEach(async () => {
    await resetDatabase();
    await prisma.user.create({
        data: { firstName: 'Jane', lastName: 'Doe', email, password: await hashPassword(strongPassword), isVerified: true },
    });
});

afterAll(() => prisma.$disconnect());

describe('refresh token rotation', () => {
    it('returns a new refresh token every time', async () => {
        const first = await signin();
        const second = (await refresh(first.refreshToken).expect(200)).body.data;
        const third = (await refresh(second.refreshToken).expect(200)).body.data;

        expect(second.refreshToken).not.toBe(first.refreshToken);
        expect(third.refreshToken).not.toBe(second.refreshToken);
        await loginHistory(third.accessToken).expect(200);
    });

    it('stores only a hash of the refresh token', async () => {
        const { refreshToken } = await signin();
        const [session] = await prisma.session.findMany();

        expect(session.tokenHash).not.toContain(refreshToken.split('.')[1]);
    });

    it('revokes the session when an old refresh token is reused', async () => {
        const first = await signin();
        const second = (await refresh(first.refreshToken).expect(200)).body.data;
        // Pretend the rotation happened a while ago, outside the grace window
        await prisma.session.updateMany({ data: { rotatedAt: new Date(Date.now() - 60 * 1000) } });

        const reuse = await refresh(first.refreshToken).expect(401);
        expect(reuse.body.code).toBe('TOKEN_REUSED');

        // Neither the attacker's nor the legitimate tokens work anymore
        await refresh(second.refreshToken).expect(401);
        const res = await loginHistory(second.accessToken).expect(401);
        expect(res.body.code).toBe('SESSION_REVOKED');
    });

    it('tolerates a concurrent refresh right after rotation', async () => {
        const first = await signin();
        const second = (await refresh(first.refreshToken).expect(200)).body.data;

        const race = await refresh(first.refreshToken).expect(401);
        expect(race.body.code).toBe('TOKEN_ROTATED');
        await refresh(second.refreshToken).expect(200);
    });

    it('rejects malformed and unknown refresh tokens', async () => {
        await refresh('garbage').expect(401);
        await refresh('nosuchsession.secret').expect(401);
    });

    it('gives each signin its own session', async () => {
        await signin();
        await signin();
        expect(await prisma.session.count()).toBe(2);
    });
});
