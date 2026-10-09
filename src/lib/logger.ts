import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';

export const logger = pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.newPassword',
            '*.currentPassword',
            '*.token',
            '*.refreshToken',
        ],
        censor: '[redacted]',
    },
    ...(env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } },
    }),
});

// Per-request logger with a request id (reuses an incoming X-Request-Id)
export const httpLogger = pinoHttp({
    logger,
    genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
    },
    customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
});
