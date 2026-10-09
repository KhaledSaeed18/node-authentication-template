import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { Role } from '../../generated/prisma/enums.js';
import { UnauthorizedError } from '../../shared/errors/app-error.js';

export interface TokenClaims {
    userId: string;
    role: Role;
}

type Expiry = NonNullable<jwt.SignOptions['expiresIn']>;

const sign = (claims: TokenClaims, secret: string, expiresIn: string) =>
    jwt.sign({ role: claims.role }, secret, {
        algorithm: 'HS256',
        subject: claims.userId,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        expiresIn: expiresIn as Expiry,
    });

// Pins the algorithm and checks issuer/audience, so tokens signed for something else
// (or with "alg": "none") are rejected
const verify = (token: string, secret: string): TokenClaims => {
    try {
        const payload = jwt.verify(token, secret, {
            algorithms: ['HS256'],
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
        }) as jwt.JwtPayload;

        if (!payload.sub || typeof payload.role !== 'string') throw new Error('Missing claims');
        return { userId: payload.sub, role: payload.role as Role };
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new UnauthorizedError('Token has expired', 'TOKEN_EXPIRED');
        }
        throw new UnauthorizedError('Invalid token', 'INVALID_TOKEN');
    }
};

export const signAccessToken = (claims: TokenClaims) => sign(claims, env.JWT_SECRET, env.ACCESS_TOKEN_TTL);
export const verifyAccessToken = (token: string) => verify(token, env.JWT_SECRET);

export const signRefreshToken = (claims: TokenClaims) => sign(claims, env.JWT_REFRESH_SECRET, env.REFRESH_TOKEN_TTL);
export const verifyRefreshToken = (token: string) => verify(token, env.JWT_REFRESH_SECRET);
