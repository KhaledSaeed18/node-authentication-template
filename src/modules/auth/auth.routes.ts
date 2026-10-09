import { type RequestHandler, Router } from 'express';
import { sanitizeRequestBody } from '../../shared/middlewares/sanitize-body.js';
import { validate } from '../../shared/middlewares/validate.js';
import type { AuthController } from './auth.controller.js';
import {
    changePasswordLimiter,
    disable2FALimiter,
    forgotPasswordLimiter,
    loginHistoryLimiter,
    refreshTokenLimiter,
    resendVerificationLimiter,
    resetPasswordLimiter,
    sessionLimiter,
    setup2FALimiter,
    signin2FALimiter,
    signinLimiter,
    signupLimiter,
    verify2FALimiter,
    verifyEmailLimiter,
} from './auth.rate-limits.js';
import {
    changePasswordSchema,
    disable2FASchema,
    forgotPasswordSchema,
    refreshTokenSchema,
    resendVerificationSchema,
    resetPasswordSchema,
    sessionIdParamsSchema,
    signin2FASchema,
    signinSchema,
    signupSchema,
    verify2FASchema,
    verifyEmailSchema,
} from './auth.schemas.js';

export const createAuthRouter = (controller: AuthController, authenticate: RequestHandler): Router => {
    const router = Router();

    router.post('/signup', signupLimiter, sanitizeRequestBody, validate(signupSchema), controller.signup);
    router.post('/signin', signinLimiter, sanitizeRequestBody, validate(signinSchema), controller.signin);
    router.post('/refresh-token', refreshTokenLimiter, validate(refreshTokenSchema), controller.refreshAccessToken);
    router.get('/login-history', loginHistoryLimiter, authenticate, controller.getLoginHistory);

    router.post('/logout', sessionLimiter, authenticate, controller.logout);
    router.post('/logout-all', sessionLimiter, authenticate, controller.logoutAll);
    router.get('/sessions', sessionLimiter, authenticate, controller.listSessions);
    router.delete(
        '/sessions/:sessionId',
        sessionLimiter,
        authenticate,
        validate(sessionIdParamsSchema, 'params'),
        controller.revokeSession
    );

    router.post('/verify-email', verifyEmailLimiter, sanitizeRequestBody, validate(verifyEmailSchema), controller.verifyEmail);
    router.post(
        '/resend-verification',
        resendVerificationLimiter,
        sanitizeRequestBody,
        validate(resendVerificationSchema),
        controller.resendVerificationCode
    );

    router.post('/forgot-password', forgotPasswordLimiter, sanitizeRequestBody, validate(forgotPasswordSchema), controller.forgotPassword);
    router.post('/reset-password', resetPasswordLimiter, sanitizeRequestBody, validate(resetPasswordSchema), controller.resetPassword);
    router.post(
        '/change-password',
        changePasswordLimiter,
        authenticate,
        validate(changePasswordSchema),
        controller.changePassword
    );

    router.post('/2fa/setup', authenticate, setup2FALimiter, controller.setup2FA);
    router.post('/2fa/verify', authenticate, verify2FALimiter, sanitizeRequestBody, validate(verify2FASchema), controller.verify2FA);
    router.post('/2fa/signin', signin2FALimiter, sanitizeRequestBody, validate(signin2FASchema), controller.signin2FA);
    router.post('/2fa/disable', authenticate, disable2FALimiter, sanitizeRequestBody, validate(disable2FASchema), controller.disable2FA);

    return router;
};
