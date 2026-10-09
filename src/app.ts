import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { httpLogger } from './lib/logger.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { prisma } from './lib/prisma.js';
import { createMailer, type Mailer } from './mail/mailer.js';
import { createAuthModule } from './modules/auth/index.js';
import { createHealthRouter, type HealthState } from './modules/health/health.routes.js';
import { errorHandler, notFoundHandler } from './shared/middlewares/error-handler.js';

export interface AppDependencies {
    db: PrismaClient;
    mailer: Mailer;
    health: HealthState;
}

// Builds the Express app without starting a server. Dependencies can be
// overridden, e.g. tests pass an in-memory mailer.
export const createApp = (overrides: Partial<AppDependencies> = {}): Express => {
    const deps: AppDependencies = {
        db: overrides.db ?? prisma,
        mailer: overrides.mailer ?? createMailer(env),
        health: overrides.health ?? { shuttingDown: false },
    };

    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', env.TRUST_PROXY);

    app.use(
        cors({
            origin: env.CORS_ORIGINS,
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            allowedHeaders: ['Content-Type', 'Authorization'],
        })
    );

    // Probes are mounted before logging so they don't flood the logs
    app.use(createHealthRouter(deps.db, deps.health));

    app.use(httpLogger);

    // Security headers, locked down further since this API only serves JSON
    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
            },
            frameguard: { action: 'deny' },
        })
    );

    app.use(express.json({ limit: '10kb' }));

    const baseUrl = `${env.BASE_URL}/${env.API_VERSION}`;

    app.use(`${baseUrl}/auth`, createAuthModule(deps).router);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
};
