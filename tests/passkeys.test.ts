import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, createTestApp, resetDatabase, strongPassword } from './helpers.js';
import { VirtualAuthenticator } from './support/virtual-authenticator.js';

const { app, mailer, worker } = createTestApp();
const auth = `${API}/auth`;

const createUser = async (email = 'jane@acme.io') =>
    prisma.user.create({
        data: { firstName: 'Jane', lastName: 'Doe', email, password: await hashPassword(strongPassword), isVerified: true },
    });

const bearerFor = async (email = 'jane@acme.io') => {
    const res = await request(app).post(`${auth}/signin`).send({ email, password: strongPassword }).expect(200);
    return `Bearer ${res.body.data.accessToken}`;
};

// Runs both registration steps and checks the final status
const registerPasskey = async (bearer: string, authenticator = new VirtualAuthenticator(), name = 'MacBook', status = 201) => {
    const { body } = await request(app).post(`${auth}/passkeys/register/options`).set('Authorization', bearer).expect(200);
    const response = authenticator.createCredential(body.data.options);
    return request(app).post(`${auth}/passkeys/register`).set('Authorization', bearer).send({ response, name }).expect(status);
};

const signinOptions = async () => (await request(app).post(`${auth}/passkeys/signin/options`).expect(200)).body.data.options;

const signinWith = (response: object) => request(app).post(`${auth}/passkeys/signin`).send({ response });

beforeEach(async () => {
    mailer.clear();
    await resetDatabase();
});

afterAll(() => prisma.$disconnect());

describe('passkey registration', () => {
    it('registers a passkey for the signed-in user', async () => {
        await createUser();
        const bearer = await bearerFor();

        const res = await registerPasskey(bearer);

        expect(res.body.data.passkey).toMatchObject({ name: 'MacBook', deviceType: 'singleDevice', backedUp: false });
        expect(res.body.data.passkey).not.toHaveProperty('publicKey');
        const list = await request(app).get(`${auth}/passkeys`).set('Authorization', bearer).expect(200);
        expect(list.body.data.passkeys).toHaveLength(1);
    });

    it('asks for a discoverable credential with user verification and excludes existing ones', async () => {
        await createUser();
        const bearer = await bearerFor();
        const authenticator = new VirtualAuthenticator();
        await registerPasskey(bearer, authenticator);

        const { body } = await request(app).post(`${auth}/passkeys/register/options`).set('Authorization', bearer).expect(200);

        expect(body.data.options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
        expect(body.data.options.excludeCredentials.map((c: { id: string }) => c.id)).toEqual([authenticator.id]);
    });

    it('rejects a registration without user verification', async () => {
        await createUser();
        const bearer = await bearerFor();
        const { body } = await request(app).post(`${auth}/passkeys/register/options`).set('Authorization', bearer).expect(200);
        const response = new VirtualAuthenticator().createCredential(body.data.options, { userVerified: false });

        const res = await request(app).post(`${auth}/passkeys/register`).set('Authorization', bearer).send({ response }).expect(401);
        expect(res.body.code).toBe('PASSKEY_VERIFICATION_FAILED');
    });

    it('rejects a registration from another origin', async () => {
        await createUser();
        const bearer = await bearerFor();
        const { body } = await request(app).post(`${auth}/passkeys/register/options`).set('Authorization', bearer).expect(200);
        const response = new VirtualAuthenticator().createCredential(body.data.options, { origin: 'https://evil.example' });

        await request(app).post(`${auth}/passkeys/register`).set('Authorization', bearer).send({ response }).expect(401);
    });

    it("rejects a registration answering another user's challenge", async () => {
        await createUser('jane@acme.io');
        await createUser('sam@acme.io');
        const jane = await bearerFor('jane@acme.io');
        const sam = await bearerFor('sam@acme.io');

        const { body } = await request(app).post(`${auth}/passkeys/register/options`).set('Authorization', jane).expect(200);
        const response = new VirtualAuthenticator().createCredential(body.data.options);

        await request(app).post(`${auth}/passkeys/register`).set('Authorization', sam).send({ response }).expect(401);
    });

    it('emails the owner when a passkey is added', async () => {
        await createUser();
        await registerPasskey(await bearerFor());

        await worker.drain();
        expect(mailer.sent.map((m) => m.content.subject)).toContain('Node Auth: a passkey named "MacBook" was added');
    });
});

describe('passkey sign-in', () => {
    it('signs in without a password and records it in the login history', async () => {
        const user = await createUser();
        const authenticator = new VirtualAuthenticator();
        await registerPasskey(await bearerFor(), authenticator);

        const res = await signinWith(authenticator.getAssertion(await signinOptions())).expect(200);

        expect(res.body.data.user.id).toBe(user.id);
        expect(res.body.data.accessToken).toEqual(expect.any(String));
        expect(res.body.data.refreshToken).toEqual(expect.any(String));
        const passkey = await prisma.passkey.findUniqueOrThrow({ where: { id: authenticator.id } });
        expect(Number(passkey.counter)).toBe(1);
        expect(passkey.lastUsedAt).not.toBeNull();
    });

    it('does not ask for a TOTP code even when 2FA is enabled', async () => {
        await createUser();
        const authenticator = new VirtualAuthenticator();
        await registerPasskey(await bearerFor(), authenticator);
        await prisma.user.updateMany({ data: { totpEnabled: true, totpSecret: 'v1:irrelevant' } });

        const res = await signinWith(authenticator.getAssertion(await signinOptions())).expect(200);
        expect(res.body.data.requiresTwoFactor).toBeUndefined();
        expect(res.body.data.accessToken).toEqual(expect.any(String));
    });

    it('rejects a replayed assertion', async () => {
        await createUser();
        const authenticator = new VirtualAuthenticator();
        await registerPasskey(await bearerFor(), authenticator);
        const assertion = authenticator.getAssertion(await signinOptions());

        await signinWith(assertion).expect(200);
        const replay = await signinWith(assertion).expect(401);
        expect(replay.body.code).toBe('PASSKEY_VERIFICATION_FAILED');
    });

    it('rejects a replayed assertion from a synced passkey, which has no counter to rely on', async () => {
        await createUser();
        const synced = new VirtualAuthenticator(true);
        const registered = await registerPasskey(await bearerFor(), synced);
        expect(registered.body.data.passkey).toMatchObject({ deviceType: 'multiDevice', backedUp: true });

        const assertion = synced.getAssertion(await signinOptions());
        await signinWith(assertion).expect(200);
        // The counter stays 0, so only the single-use challenge stops this
        await signinWith(assertion).expect(401);
        // A fresh challenge still works
        await signinWith(synced.getAssertion(await signinOptions())).expect(200);
    });

    it('rejects a cloned authenticator whose counter went backwards', async () => {
        await createUser();
        const authenticator = new VirtualAuthenticator();
        await registerPasskey(await bearerFor(), authenticator);
        const clone = authenticator.clone();

        await signinWith(authenticator.getAssertion(await signinOptions())).expect(200);
        await signinWith(authenticator.getAssertion(await signinOptions())).expect(200);

        // The clone's counter (1) is behind the stored one (2)
        await signinWith(clone.getAssertion(await signinOptions())).expect(401);
    });

    it('rejects assertions without user verification or from another origin', async () => {
        await createUser();
        const authenticator = new VirtualAuthenticator();
        await registerPasskey(await bearerFor(), authenticator);

        await signinWith(authenticator.getAssertion(await signinOptions(), { userVerified: false })).expect(401);
        await signinWith(authenticator.getAssertion(await signinOptions(), { origin: 'https://evil.example' })).expect(401);
    });

    it('rejects an assertion signed by a different key', async () => {
        await createUser();
        const authenticator = new VirtualAuthenticator();
        await registerPasskey(await bearerFor(), authenticator);

        // Same credential id and user handle, wrong private key
        const impostor = new VirtualAuthenticator();
        Object.assign(impostor, { credentialId: authenticator.credentialId, userHandle: authenticator['userHandle'] });

        await signinWith(impostor.getAssertion(await signinOptions())).expect(401);
    });

    it('rejects unknown passkeys and expired or made-up challenges', async () => {
        await createUser();
        const authenticator = new VirtualAuthenticator();
        await registerPasskey(await bearerFor(), authenticator);

        await signinWith(new VirtualAuthenticator().getAssertion(await signinOptions())).expect(401);
        await signinWith(authenticator.getAssertion({ challenge: 'bm90LWlzc3VlZC1ieS10aGUtc2VydmVy' })).expect(401);

        const options = await signinOptions();
        await prisma.webAuthnChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
        await signinWith(authenticator.getAssertion(options)).expect(401);
    });
});

describe('passkey management', () => {
    it('renames and removes passkeys, which then stop working', async () => {
        await createUser();
        const bearer = await bearerFor();
        const authenticator = new VirtualAuthenticator();
        await registerPasskey(bearer, authenticator);

        const renamed = await request(app)
            .patch(`${auth}/passkeys/${authenticator.id}`)
            .set('Authorization', bearer)
            .send({ name: 'Work laptop' })
            .expect(200);
        expect(renamed.body.data.passkey.name).toBe('Work laptop');

        await request(app).delete(`${auth}/passkeys/${authenticator.id}`).set('Authorization', bearer).expect(200);
        await signinWith(authenticator.getAssertion(await signinOptions())).expect(401);
    });

    it("can't touch another user's passkeys", async () => {
        await createUser('jane@acme.io');
        await createUser('sam@acme.io');
        const authenticator = new VirtualAuthenticator();
        await registerPasskey(await bearerFor('jane@acme.io'), authenticator);
        const sam = await bearerFor('sam@acme.io');

        await request(app).patch(`${auth}/passkeys/${authenticator.id}`).set('Authorization', sam).send({ name: 'mine' }).expect(404);
        await request(app).delete(`${auth}/passkeys/${authenticator.id}`).set('Authorization', sam).expect(404);
        expect(await prisma.passkey.count()).toBe(1);
    });
});
