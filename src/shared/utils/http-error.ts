interface CustomError extends Error {
    statusCode: number;
    status: string;
    [key: string]: unknown; 
}

// Generic error handler function
export const errorHandler = (statusCode: number, message: string, additionalData?: Record<string, unknown>) => {
    const error = new Error(message) as CustomError;
    error.statusCode = statusCode;
    error.status = statusCode >= 400 && statusCode < 500 ? "fail" : "error";

    if (additionalData) {
        Object.assign(error, additionalData);
    }

    return error;
};