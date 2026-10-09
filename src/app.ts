import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { createDocsRouter } from './docs/docs.routes.js';
import { httpLogger } from './lib/logger.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { prisma } from './lib/prisma.js';
import { createMailer, type Mailer } from './mail/mailer.js';
import { createAuthModule } from './modules/auth/index.js';
import { createKeysRouter } from './modules/keys/keys.routes.js';
import { SigningKeyStore } from './modules/keys/signing-key.store.js';
import { type BreachedPasswordChecker, PwnedPasswordsChecker, skipBreachCheck } from './shared/utils/breached-passwords.js';
import { durationToMs } from './shared/utils/duration.js';
import { OutboxWorker } from './modules/outbox/outbox.worker.js';
import { createHealthRouter, type HealthState } from './modules/health/health.routes.js';
import { createOidcModule } from './modules/oidc/index.js';
import { createUsersModule } from './modules/users/index.js';
import { errorHandler, notFoundHandler } from './shared/middlewares/error-handler.js';

export interface AppDependencies {
    db: PrismaClient;
    mailer: Mailer;
    health: HealthState;
    signingKeys: SigningKeyStore;
    breachedPasswords: BreachedPasswordChecker;
}

export interface Application {
    app: Express;
    // Delivers background jobs (emails, notices); started by server.ts or the worker script
    worker: OutboxWorker;
}

// Builds the Express app and the outbox worker without starting anything.
// Dependencies can be overridden, e.g. tests pass an in-memory mailer.
export const buildApplication = (overrides: Partial<AppDependencies> = {}): Application => {
    const db = overrides.db ?? prisma;
    const deps: AppDependencies = {
        db,
        mailer: overrides.mailer ?? createMailer(env),
        health: overrides.health ?? { shuttingDown: false },
        breachedPasswords: overrides.breachedPasswords ?? (env.PASSWORD_BREACH_CHECK ? new PwnedPasswordsChecker() : skipBreachCheck),
        signingKeys:
            overrides.signingKeys ??
            new SigningKeyStore(db, {
                rotationIntervalMs: env.SIGNING_KEY_ROTATION_DAYS * 24 * 60 * 60 * 1000,
                // Retired keys stay published until every token they signed has expired
                retiredKeyRetentionMs: durationToMs(env.ACCESS_TOKEN_TTL) + 5 * 60 * 1000,
            }),
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
    app.use(createHealthRouter(deps.db, deps.health, deps.signingKeys));

    if (env.API_DOCS_ENABLED ?? env.NODE_ENV !== 'production') {
        // Mounted before the API-wide helmet config, which is too strict for the docs UI
        app.use(createDocsRouter());
    }

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

    // Public keys for verifying access tokens
    app.use(createKeysRouter(deps.signingKeys));

    const auth = createAuthModule(deps);
    const users = createUsersModule({ db: deps.db, authenticate: auth.authenticate, authService: auth.service });
    const oidc = createOidcModule({
        db: deps.db,
        sessions: auth.sessions,
        accessTokens: auth.accessTokens,
        signingKeys: deps.signingKeys,
        authenticate: auth.authenticate,
    });

    // OpenID Connect provider endpoints live at the issuer root
    app.use(oidc.protocolRouter);

    app.use(`${baseUrl}/auth`, auth.router);
    app.use(`${baseUrl}/users`, users.router);
    app.use(`${baseUrl}/oauth-clients`, oidc.adminRouter);

    app.use(notFoundHandler);
    app.use(errorHandler);

    const worker = new OutboxWorker(deps.db, { ...auth.jobHandlers }, { pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS });

    return { app, worker };
};

export const createApp = (overrides: Partial<AppDependencies> = {}): Express => buildApplication(overrides).app;
