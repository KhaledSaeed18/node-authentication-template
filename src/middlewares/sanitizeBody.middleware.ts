import { Request, Response, NextFunction } from 'express';
import sanitizeHtml from 'sanitize-html';

// Recursively sanitize objects and arrays
function sanitizeData(data: string | number | boolean | null | undefined | Array<unknown> | Record<string, unknown>): string | number | boolean | null | undefined | Array<unknown> | Record<string, unknown> {
    if (data === null || data === undefined) {
        return data;
    }

    // Handle strings
    if (typeof data === 'string') {
        return sanitizeHtml(data, {
            allowedTags: [],
            allowedAttributes: {}
        });
    }

    // Handle arrays
    if (Array.isArray(data)) {
        return data.map(item => sanitizeData(item as string | number | boolean | null | undefined | Array<unknown> | Record<string, unknown>));
    }

    // Handle objects
    if (typeof data === 'object') {
        const sanitized: Record<string, string | number | boolean | null | undefined | Array<unknown> | Record<string, unknown>> = {};
        for (const key in data) {
            sanitized[key] = sanitizeData(data[key] as string | number | boolean | null | undefined | Array<unknown> | Record<string, unknown>);
        }
        return sanitized;
    }

    // Return other types unchanged
    return data;
}

export const sanitizeRequestBody = (req: Request, _res: Response, next: NextFunction) => {
    if (req.body) {
        req.body = sanitizeData(req.body);
    }

    next();
};