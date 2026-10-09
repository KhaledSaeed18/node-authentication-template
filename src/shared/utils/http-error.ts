import { AppError } from '../errors/app-error.js';

const defaultCodes: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    429: 'TOO_MANY_REQUESTS',
};

// Shorthand used by the auth module until it throws AppError subclasses directly
export const errorHandler = (
    statusCode: number,
    message: string,
    additionalData?: { validationErrors?: { field: string; message: string }[] }
) => new AppError(statusCode, message, defaultCodes[statusCode] ?? 'INTERNAL_SERVER_ERROR', additionalData?.validationErrors);
