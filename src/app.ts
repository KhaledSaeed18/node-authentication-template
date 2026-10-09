import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { httpLogger } from './lib/logger.js';
import AuthRouter from './modules/auth/auth.routes.js';
import { ErrorMiddleware } from './shared/middlewares/error-handler.js';

// Builds the Express app without starting a server, so tests can use it directly
export const createApp = (): Express => {
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

    app.use(`${baseUrl}/auth`, new AuthRouter().getRouter());

    app.use((_req: Request, res: Response) => {
        res.status(404).json({
            status: 'fail',
            statusCode: 404,
            message: 'Resource not found',
        });
    });

    app.use(ErrorMiddleware.handleError);

    return app;
};
