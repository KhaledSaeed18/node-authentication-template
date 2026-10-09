import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError, ConflictError, NotFoundError } from '../errors/app-error.js';

// Errors thrown by express.json() (body-parser) carry a type and an HTTP status
interface BodyParserError extends Error {
    type: string;
    status: number;
}

const isBodyParserError = (err: unknown): err is BodyParserError =>
    err instanceof Error && 'type' in err && 'status' in err && typeof err.status === 'number';

// Turn anything thrown into an AppError that is safe to send to the client
const toAppError = (err: unknown): AppError | null => {
    if (err instanceof AppError) return err;

    if (isBodyParserError(err)) {
        if (err.type === 'entity.parse.failed') return new AppError(400, 'Malformed JSON body', 'INVALID_JSON');
        if (err.type === 'entity.too.large') return new AppError(413, 'Request body is too large', 'PAYLOAD_TOO_LARGE');
        if (err.status < 500) return new AppError(err.status, 'Invalid request body', 'BAD_REQUEST');
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return new ConflictError('A record with the same unique value already exists');
    }

    return null;
};

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError());
};

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const appError = toAppError(err);

    if (!appError) {
        // Unexpected error: log everything, tell the client nothing specific
        req.log.error({ err }, 'Unhandled error');
    }

    const statusCode = appError?.statusCode ?? 500;

    res.status(statusCode).json({
        status: statusCode < 500 ? 'fail' : 'error',
        statusCode,
        code: appError?.code ?? 'INTERNAL_SERVER_ERROR',
        message: appError?.message ?? 'Internal Server Error',
        ...(appError?.validationErrors && { validationErrors: appError.validationErrors }),
        ...(env.NODE_ENV === 'development' && err instanceof Error && { stack: err.stack }),
    });
};
