import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from "cors";
import { ErrorMiddleware } from './middlewares/error.middleware';
import AuthRouter from './api/auth/auth.routes';
import { securityHeaders } from './middlewares/securityHeaders.middleware';

dotenv.config();

const app: Express = express();

const allowedOrigins = [
    "http://localhost:3000",
];

// CORS middleware
app.use(
    cors({
        origin: allowedOrigins,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

// Security middleware
app.use(securityHeaders);

// Body parser middleware
app.use(express.json());

const port = process.env.PORT;
const version = process.env.API_VERSION!;
const baseUrl = `${process.env.BASE_URL!}/${version}`;

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

app.listen(port, () => {
    console.log(`Server is running on: http://localhost:${port}`);
});
