import express, { type Express, type Request, type Response } from 'express';
import cors from "cors";
import { ErrorMiddleware } from './middlewares/error.middleware.js';
import AuthRouter from './api/auth/auth.routes.js';
import { securityHeaders } from './middlewares/securityHeaders.middleware.js';
import { env } from './config/env.js';

const app: Express = express();

// CORS middleware
app.use(
    cors({
        origin: env.CORS_ORIGINS,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

// Security middleware
app.use(securityHeaders);

// Body parser middleware
app.use(express.json());

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
        console.error('Failed to start server:', error);
        process.exit(1);
    }
    console.log(`Server is running on: http://localhost:${port}`);
});
