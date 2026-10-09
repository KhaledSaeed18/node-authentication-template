import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../../generated/prisma/enums.js';
import type { AccessTokens, TokenClaims } from '../../modules/auth/tokens.js';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';

export type AuthTokenPayload = TokenClaims;

declare module 'express' {
    interface Request {
        user?: AuthTokenPayload;
    }
}

// Requires a valid access token whose session hasn't been revoked (logout, password
// reset, ...). The session lookup makes revocation take effect immediately.
export const createAuthenticate =
    (tokens: AccessTokens, sessions: { isActive(sessionId: string): Promise<boolean> }) =>
    async (req: Request, _res: Response, next: NextFunction) => {
        const [scheme, token] = req.headers.authorization?.split(' ') ?? [];

        if (scheme !== 'Bearer' || !token) {
            throw new UnauthorizedError('Missing or malformed access token', 'MISSING_TOKEN');
        }

        const claims = await tokens.verify(token);
        if (!(await sessions.isActive(claims.sessionId))) {
            throw new UnauthorizedError('Session has ended, please sign in again', 'SESSION_REVOKED');
        }

        req.user = claims;
        next();
    };

// Requires the authenticated user to have one of the given roles (use after authenticate)
export const requireRole =
    (...roles: Role[]) =>
    (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return next(new ForbiddenError('You do not have permission to perform this action'));
        }
        next();
    };

// Returns the authenticated user's token payload (use in handlers behind authenticate)
export const currentUser = (req: Request): AuthTokenPayload => {
    if (!req.user) throw new UnauthorizedError();
    return req.user;
};
