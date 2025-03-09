import rateLimit from 'express-rate-limit';
import { errorHandler } from '../../utils/errorHandler';

// Rate limiting for signup attempts, 5 attempts per 15 minutes
export const signupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many signup attempts, please try again later"));
    }
});

// Rate limiting for signin attempts, 5 attempts per 15 minutes
export const signinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many signin attempts, please try again later"));
    }
});

// Rate limiting for Login History API, 50 requests per 15 minutes
export const loginHistoryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many requests, please try again later"));
    }
});

// Rate limiting for Refresh Token API, 50 requests per 15 minutes
export const refreshTokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many requests, please try again later"));
    }
});

// Rate limiting for Email Verification API, 10 requests per 15 minutes
export const verifyEmailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many verification attempts, please try again later"));
    }
});

// Rate limiting for Resend Verification Code API, 3 requests per 15 minutes
export const resendVerificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many resend attempts, please try again later"));
    }
});

// Rate limiting for Forgot Password API, 3 requests per 15 minutes
export const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many forgot password attempts, please try again later"));
    }
});

// Rate limiting for Reset Password API, 3 requests per 15 minutes
export const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many reset password attempts, please try again later"));
    }
});

// Rate limiting for 2FA login attempts, 5 attempts per 15 minutes
export const signin2FALimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many 2FA login attempts, please try again later"));
    }
});

// Rate limiting for 2FA setup, 3 attempts per 15 minutes
export const setup2FALimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many 2FA setup attempts, please try again later"));
    }
});

// Rate limiting for 2FA verification attempts, 5 attempts per 15 minutes
export const verify2FALimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many 2FA verification attempts, please try again later"));
    }
});

// Rate limiting for 2FA disable attempts, 3 attempts per 15 minutes
export const disable2FALimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    handler: (_req, _res, next) => {
        next(errorHandler(429, "Too many 2FA disable attempts, please try again later"));
    }
});
