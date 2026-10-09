import express, { type Express, type Request, type Response } from 'express';
import cors from "cors";
import helmet from 'helmet';
import { ErrorMiddleware } from './shared/middlewares/error-handler.js';
import AuthRouter from './modules/auth/auth.routes.js';
import { env } from './config/env.js';
import { httpLogger, logger } from './lib/logger.js';

const app: Express = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

// CORS middleware
app.use(
    cors({
        origin: env.CORS_ORIGINS,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

// Request logging
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

// Body parser middleware
app.use(express.json({ limit: '10kb' }));

const port = env.PORT;
const baseUrl = `${env.BASE_URL}/${env.API_VERSION}`;

// Authentication routes
const authRouter = new AuthRouter();
app.use(`${baseUrl}/auth`, authRouter.getRouter());

// 404 error handler
app.use((_req: Request, res: Response) => {
    res.status(404).json({
        status: "fail",
        statusCode: 404,
        message: "Resource not found"
    });
});

// Error handling middleware
app.use(ErrorMiddleware.handleError);

app.listen(port, (error) => {
    if (error) {
        logger.fatal({ err: error }, 'Failed to start server');
        process.exit(1);
    }
    logger.info(`Server is running on: http://localhost:${port}`);
});
