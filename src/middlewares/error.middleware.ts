/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextFunction, Request, Response } from "express";

interface ValidationError {
  field?: string;
  message: string;
  code?: string;
  value?: unknown;
}

class CustomError extends Error {
  statusCode: number;
  status?: string;
  validationErrors?: ValidationError[];
  [key: string]: unknown;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = "CustomError";
    this.statusCode = statusCode;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface ErrorWithProperties extends Error {
  statusCode?: number;
  status?: string;
  validationErrors?: ValidationError[];
  stack?: string;
  [key: string]: unknown;
}

class ErrorMiddleware {
  // Error handler middleware
  static handleError(err: ErrorWithProperties, req: Request, res: Response, next: NextFunction) {
    const statusCode = err.statusCode || 500;
    const status = err.status || "error";
    const message = err.message || "Internal Server Error";

    const errorResponse: Record<string, string | number | unknown> = {
      status,
      statusCode,
      message,
    };

    Object.keys(err).forEach(key => {
      if (!['status', 'statusCode', 'message', 'stack'].includes(key)) {
        errorResponse[key] = err[key];
      }
    });

    if (process.env.NODE_ENV === "development") {
      errorResponse.stack = err.stack;
    }

    res.status(statusCode).json(errorResponse);
  }
}

export { CustomError, ErrorMiddleware };