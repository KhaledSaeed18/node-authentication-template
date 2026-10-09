import { generateSync } from 'otplib';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, createTestApp, resetDatabase, strongPassword } from './helpers.js';

const { app, mailer, worker } = createTestApp();
const auth = `${API}/auth`;

const CHROME_MAC_129 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0 Safari/537.36';
const CHROME_MAC_131 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

const createUser = async (email = 'jane@acme.io', role: 'USER' | 'ADMIN' = 'USER') =>
    prisma.user.create({
        data: { firstName: 'Jane', lastName: 'Doe', email, role, password: await hashPassword(strongPassword), isVerified: true },
    });

const signin = (email = 'jane@acme.io', userAgent = CHROME_MAC_129, password = strongPassword) =>
    request(app).post(`${auth}/signin`).set('User-Agent', userAgent).send({ email, password });

const activity = async (bearer: string) =>
    (await request(app).get(`${API}/users/me/activity`).set('Authorization', bearer).expect(200)).body.data.events as {
        type: string;
        device: string;
        metadata: Record<string, unknown> | null;
    }[];

const subjects = async () => {
    await worker.drain();
    return mailer.sent.map((m) => m.content.subject);
};

beforeEach(async () => {
    mailer.clear();
    await resetDatabase();
});

afterAll(() => prisma.$disconnect());

describe('account activity', () => {
    it('records security changes, newest first, with the device', async () => {
        await createUser();
        const { body } = await signin().expect(200);
        const bearer = `Bearer ${body.data.accessToken}`;

        await request(app)
            .post(`${auth}/change-password`)
            .set('Authorization', bearer)
            .set('User-Agent', CHROME_MAC_129)
            .send({ currentPassword: strongPassword, newPassword: 'An0ther$ecretPass' })
            .expect(200);
        await request(app).post(`${auth}/logout-all`).set('Authorization', bearer).expect(200);

        const { body: again } = await signin('jane@acme.io', CHROME_MAC_129, 'An0ther$ecretPass').expect(200);
        const events = await activity(`Bearer ${again.data.accessToken}`);

        expect(events.map((e) => e.type)).toEqual(['sessions.revoked_all', 'password.changed']);
        expect(events[1].device).toBe('Chrome on macOS');
        expect(JSON.stringify(events)).not.toContain('An0ther$ecretPass');
    });

    it('only shows other users’ activity to admins', async () => {
        const jane = await createUser('jane@acme.io');
        await createUser('admin@acme.io', 'ADMIN');
        const janeBearer = `Bearer ${(await signin('jane@acme.io').expect(200)).body.data.accessToken}`;
        const adminBearer = `Bearer ${(await signin('admin@acme.io').expect(200)).body.data.accessToken}`;

        await request(app).get(`${API}/users/${jane.id}/activity`).set('Authorization', janeBearer).expect(403);
        await request(app).get(`${API}/users/${jane.id}/activity`).set('Authorization', adminBearer).expect(200);
        await request(app).get(`${API}/users/nope/activity`).set('Authorization', adminBearer).expect(404);
    });
});

describe('new device alerts', () => {
    it('stays quiet for the first sign-in and for browser updates, alerts for a new browser/OS', async () => {
        await createUser();

        await signin('jane@acme.io', CHROME_MAC_129).expect(200);
        await signin('jane@acme.io', CHROME_MAC_131).expect(200);
        expect(await subjects()).toEqual([]);

        const { body } = await signin('jane@acme.io', FIREFOX_LINUX).expect(200);
        expect(await subjects()).toEqual(['Node Auth: new sign-in from Firefox on Linux']);

        const events = await activity(`Bearer ${body.data.accessToken}`);
        expect(events[0]).toMatchObject({ type: 'signin.new_device', metadata: { device: 'Firefox on Linux' } });
    });
});

describe('lockout notice', () => {
    it('logs the lockout and emails the owner once', async () => {
        await createUser();
        for (let i = 0; i < 5; i++) await signin('jane@acme.io', CHROME_MAC_129, 'Wr0ng$Password').expect(401);
        await signin('jane@acme.io', CHROME_MAC_129, 'Wr0ng$Password').expect(429);

        expect((await subjects()).filter((s) => s.includes('locked'))).toEqual([
            'Node Auth: your account was locked for 15 minutes after 5 failed sign-in attempts',
        ]);
        expect(await prisma.securityEvent.count({ where: { type: 'account.locked' } })).toBe(1);
    });
});

describe('incidents', () => {
    it('logs and reports a reused refresh token', async () => {
        await createUser();
        const { body } = await signin().expect(200);
        const first = body.data.refreshToken;
        await request(app).post(`${auth}/refresh-token`).send({ refreshToken: first }).expect(200);
        await prisma.session.updateMany({ data: { rotatedAt: new Date(Date.now() - 60_000) } });

        await request(app).post(`${auth}/refresh-token`).send({ refreshToken: first }).expect(401);

        expect(await prisma.securityEvent.count({ where: { type: 'refresh_token.reuse_detected' } })).toBe(1);
        expect((await subjects()).some((s) => s.includes('stolen session token'))).toBe(true);
    });

    it('logs and reports the use of a recovery code', async () => {
        await createUser();
        const bearer = `Bearer ${(await signin().expect(200)).body.data.accessToken}`;
        const setup = await request(app).post(`${auth}/2fa/setup`).set('Authorization', bearer).expect(200);
        const verified = await request(app)
            .post(`${auth}/2fa/verify`)
            .set('Authorization', bearer)
            .send({ code: generateSync({ secret: setup.body.data.secret }) })
            .expect(200);

        const { mfaToken } = (await signin().expect(200)).body.data;
        await request(app)
            .post(`${auth}/2fa/signin`)
            .send({ mfaToken, code: verified.body.data.recoveryCodes[0] })
            .expect(200);

        const event = await prisma.securityEvent.findFirstOrThrow({ where: { type: 'recovery_code.used' } });
        expect(event.metadata).toEqual({ remaining: 9 });
        expect(await subjects()).toContain('Node Auth: a recovery code was used (9 left)');
    });
});
