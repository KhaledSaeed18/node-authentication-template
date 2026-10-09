import { createPublicKey, type JsonWebKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { AccessTokens } from '../src/modules/auth/tokens.js';
import { SigningKeyStore } from '../src/modules/keys/signing-key.store.js';
import { createTestApp, resetDatabase } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const claims = { userId: 'user_1', role: 'USER' as const, sessionId: 'session_1' };

const newStore = (options: Partial<{ rotationIntervalMs: number; retiredKeyRetentionMs: number }> = {}) =>
    new SigningKeyStore(prisma, { rotationIntervalMs: 30 * DAY, retiredKeyRetentionMs: 20 * 60 * 1000, ...options });

const headerOf = (token: string) => jwt.decode(token, { complete: true })!.header;

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('access tokens', () => {
    it('round-trips the claims in an ES256 token with a key id', async () => {
        const tokens = new AccessTokens(newStore());
        const token = await tokens.sign(claims);

        expect(headerOf(token)).toMatchObject({ alg: 'ES256', kid: expect.any(String) });
        expect(jwt.decode(token)).toMatchObject({ sub: 'user_1', iss: env.JWT_ISSUER, aud: env.JWT_AUDIENCE });
        expect(await tokens.verify(token)).toEqual(claims);
    });

    it('can be verified by another service using only the public JWKS', async () => {
        const { app } = createTestApp();
        const token = await new AccessTokens(newStore()).sign(claims);

        const res = await request(app).get('/.well-known/jwks.json').expect(200);
        expect(res.headers['cache-control']).toContain('max-age=300');

        const jwk = res.body.keys.find((key: { kid: string }) => key.kid === headerOf(token).kid);
        expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
        expect(jwk).not.toHaveProperty('d');

        const payload = jwt.verify(token, createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' }), { algorithms: ['ES256'] });
        expect(payload).toMatchObject({ sub: 'user_1', sid: 'session_1' });
    });

    it('rejects unsigned tokens', async () => {
        const tokens = new AccessTokens(newStore());
        const { kid } = headerOf(await tokens.sign(claims));
        const unsigned = jwt.sign({ role: 'ADMIN', sid: 's' }, '', {
            algorithm: 'none',
            subject: 'user_1',
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
            keyid: kid,
        });

        await expect(tokens.verify(unsigned)).rejects.toThrow('Invalid token');
    });

    it('rejects an HS256 token "signed" with the public key (algorithm confusion)', async () => {
        const store = newStore();
        const tokens = new AccessTokens(store);
        const { kid } = headerOf(await tokens.sign(claims));
        const publicPem = (await store.publicKey(kid!))!.export({ format: 'pem', type: 'spki' }).toString();

        // Hand-made, since jsonwebtoken itself refuses to use a PEM key as an HMAC secret
        const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
        const header = encode({ alg: 'HS256', typ: 'JWT', kid });
        const payload = encode({ role: 'ADMIN', sid: 's', sub: 'user_1', iss: env.JWT_ISSUER, aud: env.JWT_AUDIENCE });
        const { createHmac } = await import('node:crypto');
        const signature = createHmac('sha256', publicPem).update(`${header}.${payload}`).digest('base64url');

        await expect(tokens.verify(`${header}.${payload}.${signature}`)).rejects.toThrow('Invalid token');
    });

    it('rejects tampered tokens, unknown key ids and other audiences', async () => {
        const store = newStore();
        const tokens = new AccessTokens(store);
        const token = await tokens.sign(claims);

        const [header, , signature] = token.split('.');
        const elevated = Buffer.from(JSON.stringify({ ...jwt.decode(token) as object, role: 'ADMIN' })).toString('base64url');
        await expect(tokens.verify(`${header}.${elevated}.${signature}`)).rejects.toThrow('Invalid token');

        const { privateKey } = await store.signingKey();
        const foreignKid = jwt.sign({ role: 'USER', sid: 's' }, privateKey, {
            algorithm: 'ES256',
            keyid: 'not-a-key-of-ours',
            subject: 'user_1',
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
        });
        await expect(tokens.verify(foreignKid)).rejects.toThrow('Invalid token');

        const { kid } = headerOf(token);
        const otherAudience = jwt.sign({ role: 'USER', sid: 's' }, privateKey, {
            algorithm: 'ES256',
            keyid: kid,
            subject: 'user_1',
            issuer: env.JWT_ISSUER,
            audience: 'some-other-api',
        });
        await expect(tokens.verify(otherAudience)).rejects.toThrow('Invalid token');
    });
});

describe('signing key rotation', () => {
    it('keeps tokens from the previous key valid while it is still published', async () => {
        const store = newStore();
        const tokens = new AccessTokens(store);
        const before = await tokens.sign(claims);

        const newKid = await store.rotate({ force: true });
        const after = await tokens.sign(claims);

        expect(headerOf(after).kid).toBe(newKid);
        expect(headerOf(after).kid).not.toBe(headerOf(before).kid);
        expect(await tokens.verify(before)).toEqual(claims);
        expect((await store.jwks()).keys.map((k) => k.kid)).toEqual([newKid, headerOf(before).kid]);
    });

    it('drops a retired key once its tokens have expired', async () => {
        const store = newStore({ retiredKeyRetentionMs: 60_000 });
        const tokens = new AccessTokens(store);
        const old = await tokens.sign(claims);
        await store.rotate({ force: true });

        await prisma.signingKey.updateMany({
            where: { id: headerOf(old).kid },
            data: { retiredAt: new Date(Date.now() - 2 * 60_000) },
        });
        const fresh = newStore({ retiredKeyRetentionMs: 60_000 });

        await expect(new AccessTokens(fresh).verify(old)).rejects.toThrow('Invalid token');
        expect((await fresh.jwks()).keys.map((k) => k.kid)).not.toContain(headerOf(old).kid);
    });

    it('rotates on its own once the active key is too old', async () => {
        const tokens = new AccessTokens(newStore());
        const first = headerOf(await tokens.sign(claims)).kid;

        await prisma.signingKey.updateMany({ data: { createdAt: new Date(Date.now() - 31 * DAY) } });
        const second = headerOf(await new AccessTokens(newStore()).sign(claims)).kid;

        expect(second).not.toBe(first);
        expect(await prisma.signingKey.count({ where: { retiredAt: null } })).toBe(1);
    });

    it('creates a single key when several instances start at once', async () => {
        const stores = Array.from({ length: 5 }, () => newStore());
        const kids = await Promise.all(stores.map(async (store) => (await store.signingKey()).kid));

        expect(new Set(kids).size).toBe(1);
        expect(await prisma.signingKey.count()).toBe(1);
    });

    it('verifies tokens signed by another instance with a key it has not loaded yet', async () => {
        const instanceA = new AccessTokens(newStore());
        const storeB = newStore();
        const instanceB = new AccessTokens(storeB);
        await instanceB.sign(claims); // B loads the key set now

        await newStore().rotate({ force: true }); // a third instance rotates
        const token = await new AccessTokens(newStore()).sign(claims);

        expect(await instanceB.verify(token)).toEqual(claims);
        expect(await instanceA.verify(token)).toEqual(claims);
    });

    it('stores private keys encrypted', async () => {
        await newStore().signingKey();
        const [key] = await prisma.signingKey.findMany();

        expect(key.privateKey).toMatch(/^v1:/);
        expect(key.privateKey).not.toContain('PRIVATE KEY');
        expect(key.publicJwk).not.toHaveProperty('d');
    });
});

describe('misconfiguration', () => {
    it('fails closed with a clear error and reports not ready when a key cannot be decrypted', async () => {
        await newStore().signingKey();
        // Simulate a key encrypted with another ENCRYPTION_KEY
        await prisma.signingKey.updateMany({ data: { privateKey: 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAA' } });

        const store = newStore();
        await expect(store.signingKey()).rejects.toThrow(/Cannot decrypt signing key .* ENCRYPTION_KEY/);
        // No replacement key was generated behind the scenes
        expect(await prisma.signingKey.count()).toBe(1);

        const { app } = createTestApp({ signingKeys: store });
        const res = await request(app).get('/ready').expect(503);
        expect(res.body.checks.signingKeys).toBe('error');
    });
});
