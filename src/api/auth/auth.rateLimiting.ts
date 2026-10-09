import rateLimit from 'express-rate-limit';
import { errorHandler } from '../../utils/errorHandler.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Builds a limiter that allows `limit` requests per 15 minutes
const createLimiter = (limit: number, message: string) => rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
        next(errorHandler(429, message));
    }
});

export const signupLimiter = createLimiter(5, "Too many signup attempts, please try again later");
export const signinLimiter = createLimiter(5, "Too many signin attempts, please try again later");
export const loginHistoryLimiter = createLimiter(50, "Too many requests, please try again later");
export const refreshTokenLimiter = createLimiter(50, "Too many requests, please try again later");
export const verifyEmailLimiter = createLimiter(10, "Too many verification attempts, please try again later");
export const resendVerificationLimiter = createLimiter(3, "Too many resend attempts, please try again later");
export const forgotPasswordLimiter = createLimiter(3, "Too many forgot password attempts, please try again later");
export const resetPasswordLimiter = createLimiter(3, "Too many reset password attempts, please try again later");
export const signin2FALimiter = createLimiter(5, "Too many 2FA login attempts, please try again later");
export const setup2FALimiter = createLimiter(3, "Too many 2FA setup attempts, please try again later");
export const verify2FALimiter = createLimiter(5, "Too many 2FA verification attempts, please try again later");
export const disable2FALimiter = createLimiter(3, "Too many 2FA disable attempts, please try again later");
