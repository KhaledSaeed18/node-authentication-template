import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { TooManyRequestsError } from '../errors/app-error.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Builds a limiter that allows `limit` requests per 15 minutes per client
export const createLimiter = (limit: number, message = 'Too many requests, please try again later') =>
    rateLimit({
        windowMs: FIFTEEN_MINUTES,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        skip: () => !env.RATE_LIMIT_ENABLED,
        handler: (_req, _res, next) => {
            next(new TooManyRequestsError(message));
        },
    });
