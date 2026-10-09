import type { Response } from 'express';

// Consistent success envelope: { status, statusCode, message, data? }
export const sendSuccess = (res: Response, statusCode: number, message: string, data?: unknown) => {
    res.status(statusCode).json({
        status: 'success',
        statusCode,
        message,
        ...(data !== undefined && { data }),
    });
};
