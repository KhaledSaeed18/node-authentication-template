import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { Role } from '../../generated/prisma/enums.js';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import { deriveKey } from '../../shared/utils/crypto.js';
import type { SigningKeyStore } from '../keys/signing-key.store.js';

export interface TokenClaims {
    userId: string;
    role: Role;
    sessionId: string;
    // Only on tokens issued to OpenID Connect clients
    clientId?: string;
    scope?: string;
}

type Expiry = NonNullable<jwt.SignOptions['expiresIn']>;

const invalidToken = () => new UnauthorizedError('Invalid token', 'INVALID_TOKEN');

// Short-lived access tokens, signed with ES256 keys from the SigningKeyStore (refresh
// tokens are opaque, see SessionService). Anyone can verify them with the public keys
// at /.well-known/jwks.json; only this service can sign them.
export class AccessTokens {
    constructor(private readonly keys: SigningKeyStore) {}

    // Tokens for an OpenID Connect client are addressed to that client (aud = client_id),
    // so the first-party API, which expects JWT_AUDIENCE, never accepts them
    async sign(claims: TokenClaims): Promise<string> {
        const { kid, privateKey } = await this.keys.signingKey();
        const payload = {
            role: claims.role,
            sid: claims.sessionId,
            ...(claims.clientId && { client_id: claims.clientId, scope: claims.scope ?? '' }),
        };
        return jwt.sign(payload, privateKey, {
            algorithm: 'ES256',
            keyid: kid,
            subject: claims.userId,
            issuer: env.JWT_ISSUER,
            audience: claims.clientId ?? env.JWT_AUDIENCE,
            expiresIn: env.ACCESS_TOKEN_TTL as Expiry,
        });
    }

    // Pins ES256 and picks the key by kid, so unsigned tokens, HS256 tokens "signed"
    // with the public key, and tokens from retired or foreign keys are all rejected
    async verify(token: string, audience: string = env.JWT_AUDIENCE): Promise<TokenClaims> {
        const decoded = jwt.decode(token, { complete: true });
        const kid = decoded?.header.kid;
        if (!kid || decoded.header.alg !== 'ES256') throw invalidToken();

        const publicKey = await this.keys.publicKey(kid);
        if (!publicKey) throw invalidToken();

        try {
            const payload = jwt.verify(token, publicKey, {
                algorithms: ['ES256'],
                issuer: env.JWT_ISSUER,
                audience,
            }) as jwt.JwtPayload;

            if (!payload.sub || typeof payload.role !== 'string' || typeof payload.sid !== 'string') {
                throw new Error('Missing claims');
            }
            return {
                userId: payload.sub,
                role: payload.role as Role,
                sessionId: payload.sid,
                ...(typeof payload.client_id === 'string' && { clientId: payload.client_id, scope: String(payload.scope ?? '') }),
            };
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new UnauthorizedError('Token has expired', 'TOKEN_EXPIRED');
            }
            throw invalidToken();
        }
    }
}

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

