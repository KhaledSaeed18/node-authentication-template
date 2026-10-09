import rateLimit from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { env } from '../../config/env.js';
import { redis } from '../../lib/redis.js';
import { TooManyRequestsError } from '../errors/app-error.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Counters live in Redis when it's configured, so limits hold across multiple
// instances and restarts. Otherwise they are kept in memory per process.
const createStore = (name: string) => {
    const client = redis;
    if (!client) return undefined;

    return new RedisStore({
        prefix: `rate-limit:${name}:`,
        sendCommand: (...args: string[]) => client.sendCommand(args) as Promise<RedisReply>,
    });
};

// Builds a limiter that allows `limit` requests per 15 minutes per client
export const createLimiter = (name: string, limit: number, message = 'Too many requests, please try again later') =>
    rateLimit({
        windowMs: FIFTEEN_MINUTES,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        store: createStore(name),
        skip: () => !env.RATE_LIMIT_ENABLED,
        handler: (_req, _res, next) => {
            next(new TooManyRequestsError(message));
        },
    });
