import { createLimiter } from '../../shared/middlewares/rate-limit.js';

export const signupLimiter = createLimiter('signup', 5, "Too many signup attempts, please try again later");
export const signinLimiter = createLimiter('signin', 5, "Too many signin attempts, please try again later");
export const loginHistoryLimiter = createLimiter('login-history', 50, "Too many requests, please try again later");
export const refreshTokenLimiter = createLimiter('refresh-token', 50, "Too many requests, please try again later");
export const verifyEmailLimiter = createLimiter('verify-email', 10, "Too many verification attempts, please try again later");
export const resendVerificationLimiter = createLimiter('resend-verification', 3, "Too many resend attempts, please try again later");
export const forgotPasswordLimiter = createLimiter('forgot-password', 3, "Too many forgot password attempts, please try again later");
export const resetPasswordLimiter = createLimiter('reset-password', 3, "Too many reset password attempts, please try again later");
export const signin2FALimiter = createLimiter('signin-2fa', 5, "Too many 2FA login attempts, please try again later");
export const setup2FALimiter = createLimiter('setup-2fa', 3, "Too many 2FA setup attempts, please try again later");
export const verify2FALimiter = createLimiter('verify-2fa', 5, "Too many 2FA verification attempts, please try again later");
export const disable2FALimiter = createLimiter('disable-2fa', 3, "Too many 2FA disable attempts, please try again later");
export const sessionLimiter = createLimiter('session', 50, "Too many requests, please try again later");
export const changePasswordLimiter = createLimiter('change-password', 5, "Too many password change attempts, please try again later");
export const passkeyLimiter = createLimiter('passkey', 30, "Too many passkey requests, please try again later");
export const passkeySigninLimiter = createLimiter('passkey-signin', 20, "Too many passkey sign-in attempts, please try again later");
