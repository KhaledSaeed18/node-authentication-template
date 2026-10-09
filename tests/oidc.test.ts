import type { Server } from 'node:http';
import * as client from 'openid-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/shared/utils/password.js';
import { API, createTestApp, resetDatabase, strongPassword } from './helpers.js';

// A real listening server, driven by openid-client (a certified OpenID Connect relying
// party library): discovery, PKCE, state/nonce/iss checks and ID token signature
// validation against our JWKS all happen inside the library.
const { app } = createTestApp();
const ISSUER = new URL(env.OIDC_ISSUER);
const REDIRECT_URI = 'http://localhost:3000/callback';
let server: Server;

let adminBearer = '';
let userBearer = '';

const registerClient = async (options: { confidential?: boolean; firstParty?: boolean; scopes?: string[] } = {}) => {
    const res = await request(app)
        .post(`${API}/oauth-clients`)
        .set('Authorization', adminBearer)
        .send({
            name: 'Acme Notes',
            redirectUris: [REDIRECT_URI],
            scopes: options.scopes ?? ['openid', 'profile', 'email', 'offline_access'],
            confidential: options.confidential ?? true,
            firstParty: options.firstParty ?? true,
        })
        .expect(201);
    return { clientId: res.body.data.client.id as string, clientSecret: res.body.data.clientSecret as string | undefined };
};

const configFor = async (clientId: string, clientSecret?: string, auth?: client.ClientAuth) =>
    client.discovery(
        ISSUER,
        clientId,
        { ...(clientSecret && { client_secret: clientSecret }), id_token_signed_response_alg: 'ES256' },
        auth ?? (clientSecret ? undefined : client.None()),
        { execute: [client.allowInsecureRequests] }
    );

// What a browser does: follow /authorize to the login page, sign in, complete the
// interaction, and come back to the redirect URI with a code
const authorize = async (
    config: client.Configuration,
    { scope = 'openid profile email offline_access', consent }: { scope?: string; consent?: boolean } = {}
) => {
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const url = client.buildAuthorizationUrl(config, {
        redirect_uri: REDIRECT_URI,
        scope,
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
    });

    const login = await fetch(url, { redirect: 'manual' });
    const location = new URL(login.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(env.OIDC_LOGIN_URL);
    const interaction = location.searchParams.get('interaction')!;

    const completed = await request(app)
        .post(`/oauth/interactions/${interaction}/complete`)
        .set('Authorization', userBearer)
        .send(consent === undefined ? {} : { consent });

    return { completed, verifier, state, nonce, interaction };
};

const exchange = async (config: client.Configuration, flow: Awaited<ReturnType<typeof authorize>>) =>
    client.authorizationCodeGrant(config, new URL(flow.completed.body.data.redirectTo), {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
    });

const tokenRequest = (form: Record<string, string>) =>
    request(app).post('/oauth/token').type('form').send(form);

beforeAll(async () => {
    await new Promise<void>((resolve) => {
        server = app.listen(Number(ISSUER.port), () => resolve());
    });
});

beforeEach(async () => {
    await resetDatabase();
    for (const [email, role] of [['admin@acme.io', 'ADMIN'], ['jane@acme.io', 'USER']] as const) {
        await prisma.user.create({
            data: { firstName: 'Jane', lastName: 'Doe', email, role, password: await hashPassword(strongPassword), isVerified: true },
        });
    }
    const signin = async (email: string) =>
        `Bearer ${(await request(app).post(`${API}/auth/signin`).send({ email, password: strongPassword })).body.data.accessToken}`;
    adminBearer = await signin('admin@acme.io');
    userBearer = await signin('jane@acme.io');
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
});

describe('OpenID Connect provider, through a certified client library', () => {
    it('publishes a discovery document', async () => {
        const res = await request(app).get('/.well-known/openid-configuration').expect(200);
        expect(res.body).toMatchObject({
            issuer: env.OIDC_ISSUER,
            jwks_uri: `${env.OIDC_ISSUER}/.well-known/jwks.json`,
            code_challenge_methods_supported: ['S256'],
            id_token_signing_alg_values_supported: ['ES256'],
        });
    });

    it('runs the authorization code flow with PKCE for a confidential client', async () => {
        const { clientId, clientSecret } = await registerClient();
        const config = await configFor(clientId, clientSecret);

        const flow = await authorize(config);
        expect(flow.completed.status).toBe(200);
        const tokens = await exchange(config, flow);

        // Signature, iss, aud, exp, nonce were checked by openid-client
        const claims = tokens.claims()!;
        expect(claims).toMatchObject({ iss: env.OIDC_ISSUER, aud: clientId, email: 'jane@acme.io', email_verified: true, name: 'Jane Doe' });
        expect(claims.auth_time).toEqual(expect.any(Number));

        const userinfo = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
        expect(userinfo).toMatchObject({ sub: claims.sub, email: 'jane@acme.io', given_name: 'Jane' });

        const refreshed = await client.refreshTokenGrant(config, tokens.refresh_token!);
        expect(refreshed.access_token).not.toBe(tokens.access_token);
        expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    });

    it('supports client_secret_basic', async () => {
        const { clientId, clientSecret } = await registerClient();
        const config = await configFor(clientId, undefined, client.ClientSecretBasic(clientSecret));

        const tokens = await exchange(config, await authorize(config));
        expect(tokens.claims()!.aud).toBe(clientId);
    });

    it('supports public clients, which rely on PKCE alone', async () => {
        const { clientId } = await registerClient({ confidential: false });
        const config = await configFor(clientId);

        const tokens = await exchange(config, await authorize(config, { scope: 'openid email' }));
        expect(tokens.claims()).toMatchObject({ email: 'jane@acme.io' });
        expect(tokens.claims()).not.toHaveProperty('name');
        // No offline_access, no refresh token
        expect(tokens.refresh_token).toBeUndefined();
    });
});

describe('authorization request validation', () => {
    const authorizeUrl = (params: Record<string, string>) => `/oauth/authorize?${new URLSearchParams(params)}`;
    const base = (clientId: string) => ({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'openid',
        state: 'xyz',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
    });

    it('never redirects to an unregistered redirect URI or for an unknown client', async () => {
        const { clientId } = await registerClient();

        const evil = await request(app).get(authorizeUrl({ ...base(clientId), redirect_uri: 'https://evil.example/cb' })).expect(400);
        expect(evil.headers.location).toBeUndefined();
        expect(evil.body.code).toBe('INVALID_REDIRECT_URI');

        await request(app).get(authorizeUrl({ ...base('nope') })).expect(400);
    });

    it('requires PKCE with S256, the openid scope and allowed scopes', async () => {
        const { clientId } = await registerClient({ scopes: ['openid', 'email'] });
        const errorOf = async (params: Record<string, string>) => {
            const res = await request(app).get(authorizeUrl(params)).expect(302);
            const location = new URL(res.headers.location);
            expect(location.searchParams.get('state')).toBe('xyz');
            return location.searchParams.get('error');
        };

        const { code_challenge: _challenge, ...withoutPkce } = base(clientId);
        expect(await errorOf(withoutPkce)).toBe('invalid_request');
        expect(await errorOf({ ...base(clientId), code_challenge_method: 'plain' })).toBe('invalid_request');
        expect(await errorOf({ ...base(clientId), scope: 'email' })).toBe('invalid_scope');
        expect(await errorOf({ ...base(clientId), scope: 'openid offline_access' })).toBe('invalid_scope');
        expect(await errorOf({ ...base(clientId), response_type: 'token' })).toBe('unsupported_response_type');
    });
});

describe('token endpoint security', () => {
    it('rejects a wrong PKCE verifier', async () => {
        const { clientId, clientSecret } = await registerClient();
        const config = await configFor(clientId, clientSecret);
        const flow = await authorize(config);
        const code = new URL(flow.completed.body.data.redirectTo).searchParams.get('code')!;

        const res = await tokenRequest({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: client.randomPKCECodeVerifier(),
            client_id: clientId,
            client_secret: clientSecret!,
        }).expect(400);
        expect(res.body.error).toBe('invalid_grant');
    });

    it('revokes the tokens of a code that is used twice', async () => {
        const { clientId, clientSecret } = await registerClient();
        const config = await configFor(clientId, clientSecret);
        const flow = await authorize(config);
        const tokens = await exchange(config, flow);
        const code = new URL(flow.completed.body.data.redirectTo).searchParams.get('code')!;

        const replay = await tokenRequest({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: flow.verifier,
            client_id: clientId,
            client_secret: clientSecret!,
        }).expect(400);
        expect(replay.body.error).toBe('invalid_grant');

        // The access token from the first exchange no longer works
        await request(app).get('/oauth/userinfo').set('Authorization', `Bearer ${tokens.access_token}`).expect(401);
    });

    it('authenticates clients and keeps codes bound to the client they were issued to', async () => {
        const first = await registerClient();
        const second = await registerClient();
        const flow = await authorize(await configFor(first.clientId, first.clientSecret));
        const code = new URL(flow.completed.body.data.redirectTo).searchParams.get('code')!;
        const form = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: flow.verifier };

        const wrongSecret = await tokenRequest({ ...form, client_id: first.clientId, client_secret: 'wrong' }).expect(401);
        expect(wrongSecret.body.error).toBe('invalid_client');

        const otherClient = await tokenRequest({ ...form, client_id: second.clientId, client_secret: second.clientSecret! }).expect(400);
        expect(otherClient.body.error).toBe('invalid_grant');
    });

    it('stores client secrets hashed', async () => {
        const { clientId, clientSecret } = await registerClient();
        const stored = await prisma.oAuthClient.findUniqueOrThrow({ where: { id: clientId } });
        expect(stored.secretHash).not.toContain(clientSecret);
    });
});

describe('consent and token separation', () => {
    it('asks for consent once for third-party clients', async () => {
        const { clientId, clientSecret } = await registerClient({ firstParty: false });
        const config = await configFor(clientId, clientSecret);

        const withoutConsent = await authorize(config);
        expect(withoutConsent.completed.status).toBe(403);
        expect(withoutConsent.completed.body.code).toBe('CONSENT_REQUIRED');

        const info = await request(app).get(`/oauth/interactions/${withoutConsent.interaction}`).expect(200);
        expect(info.body.data.interaction).toMatchObject({ client: { name: 'Acme Notes', firstParty: false } });

        const approved = await request(app)
            .post(`/oauth/interactions/${withoutConsent.interaction}/complete`)
            .set('Authorization', userBearer)
            .send({ consent: true })
            .expect(200);
        expect(new URL(approved.body.data.redirectTo).searchParams.get('code')).toBeTruthy();

        // Remembered for the same scopes
        const again = await authorize(config);
        expect(again.completed.status).toBe(200);
    });

    it('sends the user back with access_denied when they refuse', async () => {
        const { clientId, clientSecret } = await registerClient({ firstParty: false });
        const flow = await authorize(await configFor(clientId, clientSecret), { consent: false });

        const redirect = new URL(flow.completed.body.data.redirectTo);
        expect(redirect.searchParams.get('error')).toBe('access_denied');
        expect(redirect.searchParams.get('state')).toBe(flow.state);
    });

    it("doesn't let client tokens into the account API, nor client refresh tokens into /auth/refresh-token", async () => {
        const { clientId, clientSecret } = await registerClient();
        const config = await configFor(clientId, clientSecret);
        const tokens = await exchange(config, await authorize(config));

        await request(app).get(`${API}/users/me`).set('Authorization', `Bearer ${tokens.access_token}`).expect(401);
        await request(app).post(`${API}/auth/refresh-token`).send({ refreshToken: tokens.refresh_token }).expect(401);

        // ...and the refresh token still works where it belongs
        await client.refreshTokenGrant(config, tokens.refresh_token!);
    });

    it('only lets admins manage clients', async () => {
        await request(app)
            .post(`${API}/oauth-clients`)
            .set('Authorization', userBearer)
            .send({ name: 'x', redirectUris: [REDIRECT_URI] })
            .expect(403);
        await request(app)
            .post(`${API}/oauth-clients`)
            .set('Authorization', adminBearer)
            .send({ name: 'x', redirectUris: ['http://evil.example/cb'] })
            .expect(400);
    });
});

describe('token introspection and revocation', () => {
    it('reports tokens as active until the client revokes them', async () => {
        const { clientId, clientSecret } = await registerClient();
        const config = await configFor(clientId, clientSecret);
        const tokens = await exchange(config, await authorize(config));

        const active = await client.tokenIntrospection(config, tokens.access_token);
        expect(active).toMatchObject({ active: true, client_id: clientId, token_type: 'access_token', sub: tokens.claims()!.sub });
        expect((await client.tokenIntrospection(config, tokens.refresh_token!)).active).toBe(true);

        await client.tokenRevocation(config, tokens.refresh_token!);

        expect((await client.tokenIntrospection(config, tokens.access_token)).active).toBe(false);
        await request(app).get('/oauth/userinfo').set('Authorization', `Bearer ${tokens.access_token}`).expect(401);
    });

    it("tells a client nothing about another client's tokens", async () => {
        const mine = await registerClient();
        const other = await registerClient();
        const myConfig = await configFor(mine.clientId, mine.clientSecret);
        const tokens = await exchange(myConfig, await authorize(myConfig));

        const otherConfig = await configFor(other.clientId, other.clientSecret);
        expect(await client.tokenIntrospection(otherConfig, tokens.access_token)).toEqual({ active: false });

        // Revoking someone else's token is a silent no-op
        await client.tokenRevocation(otherConfig, tokens.refresh_token!);
        expect((await client.tokenIntrospection(myConfig, tokens.access_token)).active).toBe(true);
    });

    it('only lets confidential clients introspect, and answers revocation of unknown tokens with 200', async () => {
        const { clientId } = await registerClient({ confidential: false });

        const res = await request(app).post('/oauth/introspect').type('form').send({ client_id: clientId, token: 'x' }).expect(401);
        expect(res.body.error).toBe('invalid_client');

        await request(app).post('/oauth/revoke').type('form').send({ client_id: clientId, token: 'garbage' }).expect(200);
    });
});
