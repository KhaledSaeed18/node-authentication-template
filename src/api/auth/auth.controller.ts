import { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";
import { errorHandler } from "../../utils/errorHandler";

export default class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
    this.signup = this.signup.bind(this);
    this.signin = this.signin.bind(this);
    this.getLoginHistory = this.getLoginHistory.bind(this);
    this.refreshAccessToken = this.refreshAccessToken.bind(this);
    this.verifyEmail = this.verifyEmail.bind(this);
    this.resendVerificationCode = this.resendVerificationCode.bind(this);
    this.forgotPassword = this.forgotPassword.bind(this);
    this.resetPassword = this.resetPassword.bind(this);
    this.setup2FA = this.setup2FA.bind(this);
    this.verify2FA = this.verify2FA.bind(this);
    this.signin2FA = this.signin2FA.bind(this);
    this.disable2FA = this.disable2FA.bind(this);
  }

  // Signup controller
  async signup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { firstName, lastName, email, password } = req.body;

      const result = await this.authService.signup(
        firstName,
        lastName,
        email,
        password,
      );

      res.status(201).json(result);
    } catch (err) {
      if ((err as Error).message === "User with this email already exists") {
        next(errorHandler(409, "User with this email already exists"));
        return;
      }
      next(errorHandler(500, (err as Error).message || "Signup failed, Please try again"));
    }
  }

  // Signin controller 
  async signin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;

      const result = await this.authService.signin(email, password, req);

      res.status(200).json(result);
    } catch (err) {
      if ((err as Error).message === "Invalid email or password") {
        next(errorHandler(401, "Invalid email or password"));
        return;
      }
      if ((err as Error).message === "Account not verified. Please verify your email address.") {
        next(errorHandler(403, "Account not verified. Please verify your email address."));
        return;
      }
      next(errorHandler(500, (err as Error).message || "Signin failed, Please try again"));
    }
  }

  // Get login history controller
  async getLoginHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id as string;

      const loginHistory = await this.authService.getLoginHistory(userId);

      res.status(200).json({
        status: "success",
        statusCode: 200,
        message: "Login history fetched successfully",
        data: {
          loginHistory
        }
      });
    } catch (err) {
      next(errorHandler(500, (err as Error).message || "Failed to fetch login history"));
    }
  }

  // Refresh access token controller
  async refreshAccessToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken || refreshToken === "" || refreshToken === undefined) {
        next(errorHandler(400, "Refresh Token is required"));
        return;
      }

      const result = await this.authService.refreshAccessToken(refreshToken);

      res.status(200).json({
        status: "success",
        statusCode: 200,
        message: "Access Token Refreshed Successfully",
        data: {
          accessToken: result,
        }
      });
    } catch (err) {
      next(errorHandler(500, (err as Error).message || "Failed to refresh access token"));
    }
  }

  // Verify email controller
  async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        next(errorHandler(400, "Email and verification code are required"));
        return;
      }

      const result = await this.authService.verifyEmail(email, code);

      res.status(200).json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "User not found") {
        next(errorHandler(404, "User not found"));
        return;
      }
      if (message === "Email already verified") {
        next(errorHandler(400, "Email already verified"));
        return;
      }
      if (message === "Invalid verification code") {
        next(errorHandler(400, "Invalid verification code"));
        return;
      }
      if (message === "Verification code has expired") {
        next(errorHandler(400, "Verification code has expired"));
        return;
      }
      next(errorHandler(500, "Email verification failed"));
    }
  }

  // Resend verification code controller
  async resendVerificationCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      if (!email) {
        next(errorHandler(400, "Email is required"));
        return;
      }

      const result = await this.authService.resendVerificationCode(email);

      res.status(200).json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "User not found") {
        next(errorHandler(404, "User not found"));
        return;
      }
      if (message === "Email already verified") {
        next(errorHandler(400, "Email already verified"));
        return;
      }
      next(errorHandler(500, "Failed to resend verification code"));
    }
  }

  // Forgot password controller
  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;

      if (!email) {
        next(errorHandler(400, "Email is required"));
        return;
      }

      const result = await this.authService.forgotPassword(email);

      res.status(200).json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "User not found") {
        next(errorHandler(404, "User not found"));
        return;
      }
      next(errorHandler(500, "Failed to process forgot password request"));
    }
  }

  // Reset password controller
  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, code, newPassword } = req.body;

      if (!email || !code || !newPassword) {
        next(errorHandler(400, "Email, reset code, and new password are required"));
        return;
      }

      const result = await this.authService.resetPassword(email, code, newPassword);

      res.status(200).json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "User not found") {
        next(errorHandler(404, "User not found"));
        return;
      }
      if (message === "Reset code not found or expired") {
        next(errorHandler(400, "No active reset request found"));
        return;
      }
      if (message === "Invalid reset code") {
        next(errorHandler(400, "Invalid reset code"));
        return;
      }
      if (message === "Reset code has expired") {
        next(errorHandler(400, "Reset code has expired"));
        return;
      }
      next(errorHandler(500, "Password reset failed"));
    }
  }

  // Setup 2FA controller
  async setup2FA(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      console.log(req.user);
      const userId = req.user?.userId;

      if (!userId) {
        next(errorHandler(400, "User ID is required"));
        return;
      }

      const result = await this.authService.setup2FA(userId);

      res.status(200).json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "User not found") {
        next(errorHandler(404, "User not found"));
        return;
      }
      if (message === "2FA is already enabled for this account") {
        next(errorHandler(400, "2FA is already enabled for this account"));
        return;
      }
      next(errorHandler(500, "Failed to setup 2FA"));
    }
  }

  // Verify and enable 2FA controller
  async verify2FA(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.body;
      const userId = req.user?.userId;

      if (!userId) {
        next(errorHandler(400, "User ID is required"));
        return;
      }

      if (!token) {
        next(errorHandler(400, "Token is required"));
        return;
      }

      const result = await this.authService.verify2FA(userId, token);

      res.status(200).json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "User not found") {
        next(errorHandler(404, "User not found"));
        return;
      }
      if (message === "2FA is already enabled") {
        next(errorHandler(400, "2FA is already enabled"));
        return;
      }
      if (message === "2FA setup not initiated") {
        next(errorHandler(400, "2FA setup not initiated"));
        return;
      }
      if (message === "Invalid 2FA token") {
        next(errorHandler(400, "Invalid 2FA token"));
        return;
      }
      next(errorHandler(500, "Failed to verify 2FA token"));
    }
  }

  // 2FA login (second step after password verification)
  async signin2FA(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, token } = req.body;

      if (!email || !password || !token) {
        next(errorHandler(400, "Email, password, and 2FA token are required"));
        return;
      }

      const result = await this.authService.signin2FA(email, password, token, req);

      res.status(200).json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "Invalid email or password") {
        next(errorHandler(401, "Invalid email or password"));
        return;
      }
      if (message === "Account not verified. Please verify your email address.") {
        next(errorHandler(403, "Account not verified. Please verify your email address."));
        return;
      }
      if (message === "Invalid 2FA token") {
        next(errorHandler(401, "Invalid 2FA token"));
        return;
      }
      next(errorHandler(500, "Login failed"));
    }
  }

  // Disable 2FA controller
  async disable2FA(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.body;
      const userId = req.user?.userId;

      if (!userId) {
        next(errorHandler(400, "User ID is required"));
        return;
      }

      if (!token) {
        next(errorHandler(400, "Token is required"));
        return;
      }

      const result = await this.authService.disable2FA(userId, token);

      res.status(200).json(result);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "User not found") {
        next(errorHandler(404, "User not found"));
        return;
      }
      if (message === "2FA is not enabled for this account") {
        next(errorHandler(400, "2FA is not enabled for this account"));
        return;
      }
      if (message === "Invalid 2FA token") {
        next(errorHandler(400, "Invalid 2FA token"));
        return;
      }
      next(errorHandler(500, "Failed to disable 2FA"));
    }
  }
}