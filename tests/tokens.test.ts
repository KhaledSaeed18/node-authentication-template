import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { signAccessToken, verifyAccessToken } from '../src/modules/auth/tokens.js';

const claims = { userId: 'user_1', role: 'USER' as const, sessionId: 'session_1' };

describe('access tokens', () => {
    it('round-trips the user id and role', () => {
        expect(verifyAccessToken(signAccessToken(claims))).toEqual(claims);
    });

    it('uses the standard sub claim', () => {
        const decoded = jwt.decode(signAccessToken(claims)) as jwt.JwtPayload;
        expect(decoded).toMatchObject({ sub: 'user_1', iss: env.JWT_ISSUER, aud: env.JWT_AUDIENCE });
    });

    it('rejects unsigned tokens (alg none)', () => {
        const unsigned = jwt.sign({ role: 'ADMIN', sid: 'session_1' }, '', {
            algorithm: 'none',
            subject: 'user_1',
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
        });
        expect(() => verifyAccessToken(unsigned)).toThrow('Invalid token');
    });

    it('rejects tokens for another audience or issuer', () => {
        const other = jwt.sign({ role: 'USER', sid: 'session_1' }, env.JWT_SECRET, { subject: 'user_1', issuer: 'someone-else', audience: env.JWT_AUDIENCE });
        expect(() => verifyAccessToken(other)).toThrow('Invalid token');
    });

    it('rejects tokens signed with another algorithm', () => {
        const hs512 = jwt.sign({ role: 'USER', sid: 'session_1' }, env.JWT_SECRET, {
            algorithm: 'HS512',
            subject: 'user_1',
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
        });
        expect(() => verifyAccessToken(hs512)).toThrow('Invalid token');
    });

    it('rejects tokens signed with another secret', () => {
        const forged = jwt.sign({ role: 'ADMIN', sid: 'session_1' }, 'some-other-secret-that-is-long-enough!!', {
            subject: 'user_1',
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
        });
        expect(() => verifyAccessToken(forged)).toThrow('Invalid token');
    });
});
