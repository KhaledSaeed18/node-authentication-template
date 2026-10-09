import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../../generated/prisma/enums.js';
import { type TokenClaims, verifyAccessToken } from '../../modules/auth/tokens.js';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';

export type AuthTokenPayload = TokenClaims;

declare module 'express' {
    interface Request {
        user?: AuthTokenPayload;
    }
}

// Requires a valid access token in the Authorization header
export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
        return next(new UnauthorizedError('Missing or malformed access token', 'MISSING_TOKEN'));
    }

    try {
        req.user = verifyAccessToken(token);
        next();
    } catch (error) {
        next(error);
    }
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
