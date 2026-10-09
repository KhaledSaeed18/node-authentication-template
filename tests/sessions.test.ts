import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, eventually, InMemoryMailer, resetDatabase, strongPassword } from './helpers.js';

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

describe('logout and session management', () => {
    const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

    it('logout ends only the current session', async () => {
        const laptop = await signin();
        const phone = await signin();

        await request(app).post(`${auth}/logout`).set(bearer(laptop.accessToken)).expect(200);

        await loginHistory(laptop.accessToken).expect(401);
        await refresh(laptop.refreshToken).expect(401);
        await loginHistory(phone.accessToken).expect(200);
    });

    it('logout-all ends every session', async () => {
        const laptop = await signin();
        const phone = await signin();

        const res = await request(app).post(`${auth}/logout-all`).set(bearer(phone.accessToken)).expect(200);
        expect(res.body.data.revokedSessions).toBe(2);

        await loginHistory(laptop.accessToken).expect(401);
        await loginHistory(phone.accessToken).expect(401);
    });

    it('lists active sessions and marks the current one', async () => {
        await signin();
        const current = await signin();

        const res = await request(app).get(`${auth}/sessions`).set(bearer(current.accessToken)).expect(200);
        const sessions = res.body.data.sessions;

        expect(sessions).toHaveLength(2);
        expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
        expect(sessions[0]).not.toHaveProperty('tokenHash');
    });

    it('revokes a single session by id, but not another user\'s', async () => {
        const laptop = await signin();
        const phone = await signin();
        const laptopSessionId = laptop.refreshToken.split('.')[0];

        await request(app).delete(`${auth}/sessions/${laptopSessionId}`).set(bearer(phone.accessToken)).expect(200);
        await loginHistory(laptop.accessToken).expect(401);

        await prisma.user.create({
            data: { firstName: 'Sam', lastName: 'Roe', email: 'sam@acme.io', password: await hashPassword(strongPassword), isVerified: true },
        });
        const sam = (await request(app).post(`${auth}/signin`).send({ email: 'sam@acme.io', password: strongPassword })).body.data;
        const phoneSessionId = phone.refreshToken.split('.')[0];

        await request(app).delete(`${auth}/sessions/${phoneSessionId}`).set(bearer(sam.accessToken)).expect(404);
        await loginHistory(phone.accessToken).expect(200);
    });
});

describe('password changes end sessions', () => {
    const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
    const newPassword = 'An0ther$ecretPass';

    it('change-password keeps the current session and signs out the others', async () => {
        const laptop = await signin();
        const phone = await signin();

        await request(app)
            .post(`${auth}/change-password`)
            .set(bearer(phone.accessToken))
            .send({ currentPassword: strongPassword, newPassword })
            .expect(200);

        await loginHistory(phone.accessToken).expect(200);
        await loginHistory(laptop.accessToken).expect(401);
        await request(app).post(`${auth}/signin`).send({ email, password: newPassword }).expect(200);
    });

    it('change-password requires the right current password', async () => {
        const { accessToken } = await signin();

        const res = await request(app)
            .post(`${auth}/change-password`)
            .set(bearer(accessToken))
            .send({ currentPassword: 'Wr0ng$Password', newPassword })
            .expect(400);
        expect(res.body.code).toBe('INVALID_PASSWORD');
    });

    it('change-password rejects reusing the same password', async () => {
        const { accessToken } = await signin();

        await request(app)
            .post(`${auth}/change-password`)
            .set(bearer(accessToken))
            .send({ currentPassword: strongPassword, newPassword: strongPassword })
            .expect(400);
    });

    it('password reset signs out every session', async () => {
        const mailer = new InMemoryMailer();
        const resetApp = createApp({ mailer });
        const session = await signin();

        await request(resetApp).post(`${auth}/forgot-password`).send({ email }).expect(200);
        const code = await eventually(() => mailer.lastCode(email));
        await request(resetApp).post(`${auth}/reset-password`).send({ email, code, newPassword }).expect(200);

        await loginHistory(session.accessToken).expect(401);
        await refresh(session.refreshToken).expect(401);
    });
});

describe('login history pagination', () => {
    it('pages through attempts newest first with a cursor', async () => {
        for (let i = 0; i < 4; i++) await request(app).post(`${auth}/signin`).send({ email, password: 'Wr0ng$Password' });
        const { accessToken } = await signin();

        const first = await loginHistory(accessToken).query({ limit: 3 }).expect(200);
        expect(first.body.data.loginHistory).toHaveLength(3);
        expect(first.body.data.loginHistory[0].successful).toBe(true);
        expect(first.body.data.nextCursor).toEqual(expect.any(String));

        const second = await loginHistory(accessToken).query({ limit: 3, cursor: first.body.data.nextCursor }).expect(200);
        expect(second.body.data.loginHistory).toHaveLength(2);
        expect(second.body.data.nextCursor).toBeNull();

        const ids = [...first.body.data.loginHistory, ...second.body.data.loginHistory].map((h: { id: string }) => h.id);
        expect(new Set(ids).size).toBe(5);
    });

    it('rejects an out of range limit', async () => {
        const { accessToken } = await signin();
        await loginHistory(accessToken).query({ limit: 1000 }).expect(400);
    });
});
