export interface FieldError {
    field: string;
    message: string;
}

// Base class for errors that are safe to show to the client
export class AppError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string,
        public readonly code: string,
        public readonly validationErrors?: FieldError[]
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class BadRequestError extends AppError {
    constructor(message = 'Bad request', code = 'BAD_REQUEST') {
        super(400, message, code);
    }
}

export class ValidationError extends AppError {
    constructor(validationErrors: FieldError[], message = 'Validation failed. Please check your input.') {
        super(400, message, 'VALIDATION_ERROR', validationErrors);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
        super(401, message, code);
    }
}

export class ForbiddenError extends AppError {
    constructor(message = 'Forbidden', code = 'FORBIDDEN') {
        super(403, message, code);
    }
}

export class NotFoundError extends AppError {
    constructor(message = 'Resource not found', code = 'NOT_FOUND') {
        super(404, message, code);
    }
}

export class ConflictError extends AppError {
    constructor(message = 'Conflict', code = 'CONFLICT') {
        super(409, message, code);
    }
}

export class TooManyRequestsError extends AppError {
    constructor(message = 'Too many requests, please try again later', code = 'TOO_MANY_REQUESTS') {
        super(429, message, code);
    }
}
