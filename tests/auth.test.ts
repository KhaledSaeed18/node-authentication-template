import { generateSync } from 'otplib';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { API, InMemoryMailer, resetDatabase, strongPassword } from './helpers.js';

const mailer = new InMemoryMailer();
const app = createApp({ mailer });
const auth = `${API}/auth`;

const signup = (email = 'jane@acme.io', password = strongPassword) =>
    request(app).post(`${auth}/signup`).send({ firstName: 'Jane', lastName: 'Doe', email, password });

// Signs up and verifies a user, returns its credentials
const createVerifiedUser = async (email = 'jane@acme.io', password = strongPassword) => {
    await signup(email, password).expect(201);
    await request(app)
        .post(`${auth}/verify-email`)
        .send({ email, code: mailer.lastCode(email, 'Verify') })
        .expect(200);
    return { email, password };
};

const signin = (email: string, password: string) =>
    request(app).post(`${auth}/signin`).send({ email, password });

beforeEach(async () => {
    mailer.clear();
    await resetDatabase();
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe('signup and email verification', () => {
    it('creates an unverified user and emails a 6 digit code', async () => {
        const res = await signup().expect(201);

        expect(res.body.data.user).toMatchObject({ email: 'jane@acme.io', isVerified: false });
        expect(res.body.data.user.password).toBeUndefined();
        expect(mailer.lastCode('jane@acme.io', 'Verify')).toMatch(/^\d{6}$/);
    });

    it('rejects a duplicate email', async () => {
        await signup().expect(201);
        await signup().expect(409);
    });

    it('rejects weak passwords and blocked domains with field errors', async () => {
        const res = await signup('x@mailinator.com', 'weak').expect(400);

        expect(res.body.code).toBe('VALIDATION_ERROR');
        const fields = res.body.validationErrors.map((e: { field: string }) => e.field);
        expect(fields).toContain('email');
        expect(fields).toContain('password');
    });

    it('does not sign in before the email is verified', async () => {
        await signup().expect(201);
        await signin('jane@acme.io', strongPassword).expect(403);
    });

    it('rejects a wrong verification code', async () => {
        await signup().expect(201);
        const code = mailer.lastCode('jane@acme.io') === '000000' ? '111111' : '000000';
        await request(app).post(`${auth}/verify-email`).send({ email: 'jane@acme.io', code }).expect(400);
    });
});

describe('signin and tokens', () => {
    it('returns access and refresh tokens for valid credentials', async () => {
        const { email, password } = await createVerifiedUser();
        const res = await signin(email, password).expect(200);

        expect(res.body.data.accessToken).toEqual(expect.any(String));
        expect(res.body.data.refreshToken).toEqual(expect.any(String));
    });

    it('rejects a wrong password', async () => {
        const { email } = await createVerifiedUser();
        await signin(email, 'Wr0ng$Password').expect(401);
    });

    it('issues a new access token from a refresh token', async () => {
        const { email, password } = await createVerifiedUser();
        const { body } = await signin(email, password).expect(200);

        const res = await request(app)
            .post(`${auth}/refresh-token`)
            .send({ refreshToken: body.data.refreshToken })
            .expect(200);
        expect(res.body.data.accessToken).toEqual(expect.any(String));
    });

    it('rejects an invalid refresh token with 401', async () => {
        const res = await request(app).post(`${auth}/refresh-token`).send({ refreshToken: 'not.a.jwt' }).expect(401);
        expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('trims the email before looking the user up', async () => {
        const { password } = await createVerifiedUser();
        await signin('  jane@acme.io ', password).expect(200);
    });
});

describe('login history', () => {
    it('requires authentication', async () => {
        const res = await request(app).get(`${auth}/login-history`).expect(401);
        expect(res.body.code).toBe('MISSING_TOKEN');
    });

    it('only returns the signed-in user\'s own attempts', async () => {
        const jane = await createVerifiedUser('jane@acme.io');
        const sam = await createVerifiedUser('sam@acme.io');
        await signin(jane.email, 'Wr0ng$Password').expect(401);
        await signin(jane.email, jane.password).expect(200);
        const { body } = await signin(sam.email, sam.password).expect(200);

        const res = await request(app)
            .get(`${auth}/login-history`)
            .set('Authorization', `Bearer ${body.data.accessToken}`)
            .expect(200);

        const history = res.body.data.loginHistory;
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ successful: true });
    });
});

describe('password reset', () => {
    it('resets the password with the emailed code', async () => {
        const { email, password } = await createVerifiedUser();
        await request(app).post(`${auth}/forgot-password`).send({ email }).expect(200);
        const code = mailer.lastCode(email, 'Reset');

        const newPassword = 'An0ther$ecretPass';
        await request(app).post(`${auth}/reset-password`).send({ email, code, newPassword }).expect(200);

        await signin(email, password).expect(401);
        await signin(email, newPassword).expect(200);
    });
});

describe('two-factor authentication', () => {
    it('enables 2FA, requires a TOTP code at signin, then disables it', async () => {
        const { email, password } = await createVerifiedUser();
        const { body } = await signin(email, password).expect(200);
        const bearer = `Bearer ${body.data.accessToken}`;

        const setup = await request(app).post(`${auth}/2fa/setup`).set('Authorization', bearer).expect(200);
        const { secret, qrCode } = setup.body.data;
        expect(qrCode).toMatch(/^data:image\/png;base64,/);

        await request(app).post(`${auth}/2fa/verify`).set('Authorization', bearer).send({ token: '000000' }).expect(400);
        await request(app)
            .post(`${auth}/2fa/verify`)
            .set('Authorization', bearer)
            .send({ token: generateSync({ secret }) })
            .expect(200);

        const pending = await signin(email, password).expect(200);
        expect(pending.body.data.requiresOtp).toBe(true);
        expect(pending.body.data.accessToken).toBeUndefined();

        await request(app).post(`${auth}/2fa/signin`).send({ email, password, token: '000000' }).expect(401);
        const done = await request(app)
            .post(`${auth}/2fa/signin`)
            .send({ email, password, token: generateSync({ secret }) })
            .expect(200);
        expect(done.body.data.accessToken).toEqual(expect.any(String));

        await request(app)
            .post(`${auth}/2fa/disable`)
            .set('Authorization', bearer)
            .send({ token: generateSync({ secret }) })
            .expect(200);
        await signin(email, password).expect(200);
    });
});
