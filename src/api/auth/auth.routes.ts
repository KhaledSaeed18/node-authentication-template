import { Router } from "express";
import AuthController from "./auth.controller";
import { loginHistoryLimiter, refreshTokenLimiter, signinLimiter, signupLimiter, verifyEmailLimiter, resendVerificationLimiter, forgotPasswordLimiter, resetPasswordLimiter, setup2FALimiter, verify2FALimiter, signin2FALimiter, disable2FALimiter } from "./auth.rateLimiting";
import { validateDisable2FA, validateForgotPassword, validateLogin2FA, validateRefreshToken, validateResendVerification, validateResetPassword, validateSignin, validateSignup, validateVerify2FA, validateVerifyEmail } from "./auth.validation";
import { authorize } from "../../middlewares/authorization.middleware";
import { sanitizeRequestBody } from '../../middlewares/sanitizeBody.middleware';

export default class AuthRouter {
  private router: Router;
  private authController: AuthController;

  constructor() {
    this.router = Router();
    this.authController = new AuthController();
    this.initRoutes();
  }

  private initRoutes(): void {
    // Signup route
    this.router.post(
      "/signup",
      signupLimiter,
      sanitizeRequestBody,
      validateSignup,
      this.authController.signup
    );

    // Signin route
    this.router.post(
      "/signin",
      signinLimiter,
      sanitizeRequestBody,
      validateSignin,
      this.authController.signin
    );

    // Get user login history route
    this.router.get(
      "/login-history",
      loginHistoryLimiter,
      authorize,
      this.authController.getLoginHistory
    );

    // Refresh token route
    this.router.post(
      "/refresh-token",
      refreshTokenLimiter,
      validateRefreshToken,
      this.authController.refreshAccessToken
    );

    // Email verification route
    this.router.post(
      "/verify-email",
      verifyEmailLimiter,
      sanitizeRequestBody,
      validateVerifyEmail,
      this.authController.verifyEmail
    );

    // Resend verification code route
    this.router.post(
      "/resend-verification",
      resendVerificationLimiter,
      sanitizeRequestBody,
      validateResendVerification,
      this.authController.resendVerificationCode
    );

    // Forgot password route
    this.router.post(
      "/forgot-password",
      forgotPasswordLimiter,
      sanitizeRequestBody,
      validateForgotPassword,
      this.authController.forgotPassword
    );

    // Reset password route
    this.router.post(
      "/reset-password",
      resetPasswordLimiter,
      sanitizeRequestBody,
      validateResetPassword,
      this.authController.resetPassword
    );

    // Setup 2FA (get QR code)
    this.router.post(
      "/2fa/setup",
      authorize,
      setup2FALimiter,
      this.authController.setup2FA
    );

    // Verify and enable 2FA
    this.router.post(
      "/2fa/verify",
      authorize,
      verify2FALimiter,
      sanitizeRequestBody,
      validateVerify2FA,
      this.authController.verify2FA
    );

    // 2FA login (second step)
    this.router.post(
      "/2fa/signin",
      signin2FALimiter,
      sanitizeRequestBody,
      validateLogin2FA,
      this.authController.signin2FA
    );

    // Disable 2FA
    this.router.post(
      "/2fa/disable",
      authorize,
      disable2FALimiter,
      sanitizeRequestBody,
      validateDisable2FA,
      this.authController.disable2FA
    );
  }

  // Returns the router object
  public getRouter(): Router {
    return this.router;
  }
}