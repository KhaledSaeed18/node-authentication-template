import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload, TokenExpiredError } from 'jsonwebtoken';
import { errorHandler } from '../utils/errorHandler';
import { Role } from '@prisma/client';

declare module 'express' {
    interface Request {
        user?: JwtPayload & { role?: Role };
    }
}

// Middleware to check authorization
export const authorize = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(errorHandler(403, 'Access denied: invalid token format'));
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
        req.user = decoded;

        next();
    } catch (error) {
        if (error instanceof TokenExpiredError) {
            return next(errorHandler(401, 'Unauthorized: Token has expired'));
        }
        next(errorHandler(401, 'Unauthorized: Invalid token'));
    }
};

// Middleware to check for admin role
export const authorizeAdmin = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || req.user.role !== 'ADMIN') {
        return next(errorHandler(403, 'Access denied: Admin privileges required'));
    }

    next();
};