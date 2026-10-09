import { createClient } from 'redis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// Only created when REDIS_URL is set; everything that uses it has an in-memory fallback
export const redis = env.REDIS_URL ? createClient({ url: env.REDIS_URL }) : null;

if (redis) {
    redis.on('error', (error) => logger.error({ err: error }, 'Redis error'));
    await redis.connect();
}
