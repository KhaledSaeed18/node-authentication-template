import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { ValidationError } from '../errors/app-error.js';

type RequestPart = 'body' | 'query' | 'params';

// Validates part of the request and replaces it with the parsed (trimmed, stripped) data
export const validate =
    (schema: z.ZodType, part: RequestPart = 'body') =>
    (req: Request, _res: Response, next: NextFunction) => {
        const result = schema.safeParse(req[part]);

        if (!result.success) {
            const validationErrors = result.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            }));
            return next(new ValidationError(validationErrors));
        }

        // req.query is a getter in Express 5, so it has to be redefined rather than assigned
        Object.defineProperty(req, part, { value: result.data, writable: true, enumerable: true, configurable: true });
        next();
    };
