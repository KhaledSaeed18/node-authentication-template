import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { Role } from '../../generated/prisma/enums.js';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import { deriveKey } from '../../shared/utils/crypto.js';

export interface TokenClaims {
    userId: string;
    role: Role;
    sessionId: string;
}

type Expiry = NonNullable<jwt.SignOptions['expiresIn']>;

const sign = (claims: TokenClaims, secret: string, expiresIn: string) =>
    jwt.sign({ role: claims.role, sid: claims.sessionId }, secret, {
        algorithm: 'HS256',
        subject: claims.userId,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        expiresIn: expiresIn as Expiry,
    });

// Access tokens are short-lived JWTs; refresh tokens are opaque (see SessionService).
// Pins the algorithm and checks issuer/audience, so tokens signed for something else
// (or with "alg": "none") are rejected
const verify = (token: string, secret: string): TokenClaims => {
    try {
        const payload = jwt.verify(token, secret, {
            algorithms: ['HS256'],
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
        }) as jwt.JwtPayload;

        if (!payload.sub || typeof payload.role !== 'string' || typeof payload.sid !== 'string') {
            throw new Error('Missing claims');
        }
        return { userId: payload.sub, role: payload.role as Role, sessionId: payload.sid };
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new UnauthorizedError('Token has expired', 'TOKEN_EXPIRED');
        }
        throw new UnauthorizedError('Invalid token', 'INVALID_TOKEN');
    }
};

export const signAccessToken = (claims: TokenClaims) => sign(claims, env.JWT_SECRET, env.ACCESS_TOKEN_TTL);
export const verifyAccessToken = (token: string) => verify(token, env.JWT_SECRET);

// Proof that the password step of a 2FA signin succeeded. Short-lived, signed with
// its own key and purpose so it can't be used as an access token or vice versa.
const MFA_TOKEN_TTL = '5m';
const mfaKey = deriveKey('mfa-token');
const MFA_PURPOSE = 'mfa';

export const signMfaToken = (userId: string): string =>
    jwt.sign({ purpose: MFA_PURPOSE }, mfaKey, {
        algorithm: 'HS256',
        subject: userId,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        expiresIn: MFA_TOKEN_TTL,
    });

export const verifyMfaToken = (token: string): string => {
    try {
        const payload = jwt.verify(token, mfaKey, {
            algorithms: ['HS256'],
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
        }) as jwt.JwtPayload;

        if (payload.purpose !== MFA_PURPOSE || !payload.sub) throw new Error('Wrong token purpose');
        return payload.sub;
    } catch {
        throw new UnauthorizedError('Two-factor session expired, please sign in again', 'INVALID_MFA_TOKEN');
    }
};

