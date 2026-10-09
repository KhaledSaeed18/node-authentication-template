import { generateSync } from 'otplib';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { API, eventually, InMemoryMailer, resetDatabase, strongPassword } from './helpers.js';

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

    it('issues new tokens from a refresh token', async () => {
        const { email, password } = await createVerifiedUser();
        const { body } = await signin(email, password).expect(200);

        const res = await request(app)
            .post(`${auth}/refresh-token`)
            .send({ refreshToken: body.data.refreshToken })
            .expect(200);
        expect(res.body.data.accessToken).toEqual(expect.any(String));
        expect(res.body.data.refreshToken).not.toBe(body.data.refreshToken);
    });

    it('rejects an invalid refresh token with 401', async () => {
        const res = await request(app).post(`${auth}/refresh-token`).send({ refreshToken: 'not.a.jwt' }).expect(401);
        expect(res.body.code).toBe('INVALID_TOKEN');
    });

    it('treats emails case-insensitively', async () => {
        const { password } = await createVerifiedUser();
        await signin('Jane@ACME.io', password).expect(200);
        await signup('JANE@acme.io').expect(409);
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
        const code = await eventually(() => mailer.lastCode(email, 'Reset'));

        const newPassword = 'An0ther$ecretPass';
        await request(app).post(`${auth}/reset-password`).send({ email, code, newPassword }).expect(200);

        await signin(email, password).expect(401);
        await signin(email, newPassword).expect(200);
    });
});

// Each TOTP code works once; pretend the next 30s window started
const nextTotpWindow = () => prisma.user.updateMany({ data: { totpLastUsedStep: null } });

const enable2FA = async (bearer: string) => {
    const setup = await request(app).post(`${auth}/2fa/setup`).set('Authorization', bearer).expect(200);
    const { secret } = setup.body.data;
    await request(app).post(`${auth}/2fa/verify`).set('Authorization', bearer).send({ token: generateSync({ secret }) }).expect(200);
    await nextTotpWindow();
    return secret as string;
};

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
        await nextTotpWindow();

        const pending = await signin(email, password).expect(200);
        expect(pending.body.data.requiresTwoFactor).toBe(true);
        expect(pending.body.data.accessToken).toBeUndefined();
        const { mfaToken } = pending.body.data;

        await request(app).post(`${auth}/2fa/signin`).send({ mfaToken, code: '000000' }).expect(401);
        const done = await request(app)
            .post(`${auth}/2fa/signin`)
            .send({ mfaToken, code: generateSync({ secret }) })
            .expect(200);
        expect(done.body.data.accessToken).toEqual(expect.any(String));
        await nextTotpWindow();

        await request(app)
            .post(`${auth}/2fa/disable`)
            .set('Authorization', bearer)
            .send({ token: generateSync({ secret }) })
            .expect(200);
        await signin(email, password).expect(200);
    });

    it('stores the TOTP secret encrypted', async () => {
        const { email, password } = await createVerifiedUser();
        const { body } = await signin(email, password).expect(200);
        const secret = await enable2FA(`Bearer ${body.data.accessToken}`);

        const user = await prisma.user.findUniqueOrThrow({ where: { email } });
        expect(user.totpSecret).toMatch(/^v1:/);
        expect(user.totpSecret).not.toContain(secret);
    });

    it('rejects a TOTP code that was already used', async () => {
        const { email, password } = await createVerifiedUser();
        const { body } = await signin(email, password).expect(200);
        const secret = await enable2FA(`Bearer ${body.data.accessToken}`);

        const { mfaToken } = (await signin(email, password).expect(200)).body.data;
        const code = generateSync({ secret });
        await request(app).post(`${auth}/2fa/signin`).send({ mfaToken, code }).expect(200);
        await request(app).post(`${auth}/2fa/signin`).send({ mfaToken, code }).expect(401);
    });

    it('keeps working for secrets stored in plaintext by older versions', async () => {
        const { email, password } = await createVerifiedUser();
        const legacySecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
        await prisma.user.update({ where: { email }, data: { totpSecret: legacySecret, totpEnabled: true } });

        const { mfaToken } = (await signin(email, password).expect(200)).body.data;
        await request(app)
            .post(`${auth}/2fa/signin`)
            .send({ mfaToken, code: generateSync({ secret: legacySecret }) })
            .expect(200);

        const user = await prisma.user.findUniqueOrThrow({ where: { email } });
        expect(user.totpSecret).toMatch(/^v1:/);
    });

    it('only accepts a challenge token from a correct password step', async () => {
        const { email, password } = await createVerifiedUser();
        const { body } = await signin(email, password).expect(200);
        const secret = await enable2FA(`Bearer ${body.data.accessToken}`);

        // An access token is not a challenge token
        const forged = await request(app)
            .post(`${auth}/2fa/signin`)
            .send({ mfaToken: body.data.accessToken, code: generateSync({ secret }) })
            .expect(401);
        expect(forged.body.code).toBe('INVALID_MFA_TOKEN');

        await signin(email, 'Wr0ng$Password').expect(401);
    });

    it('locks the account after too many wrong codes', async () => {
        const { email, password } = await createVerifiedUser();
        const { body } = await signin(email, password).expect(200);
        const secret = await enable2FA(`Bearer ${body.data.accessToken}`);
        const { mfaToken } = (await signin(email, password).expect(200)).body.data;

        for (let i = 0; i < 5; i++) {
            await request(app).post(`${auth}/2fa/signin`).send({ mfaToken, code: '000000' }).expect(401);
        }
        const locked = await request(app)
            .post(`${auth}/2fa/signin`)
            .send({ mfaToken, code: generateSync({ secret }) })
            .expect(429);
        expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    });
});
