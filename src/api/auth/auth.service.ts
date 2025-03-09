import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateAccessToken, generateRefreshToken } from "../../utils/generateTokens";
import { Request } from "express";
import jwt, { TokenExpiredError } from "jsonwebtoken";
import { generateOTP } from "../../utils/generateOTP";
import { sendPasswordResetEmail, sendVerificationEmail } from "../../mails/email";
import { generateQRCode, generateTOTPSecret, verifyTOTP } from "../../utils/totp";

export class AuthService {
  private prisma: PrismaClient;
  private saltRounds = parseInt(process.env.SALT_ROUNDS || '10');

  constructor() {
    this.prisma = new PrismaClient();
  }

  // Helper method to generate code expiry
  private generateCodeExpiry(): Date {
    return new Date(Date.now() + 15 * 60 * 1000);
  }

  // Helper method to extract device info from request
  private extractDeviceInfo(req: Request): {
    ipAddress: string | null;
    userAgent: string | null;
    device: string | null;
    location: string | null;
  } {
    // Get Request IP address
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      null;

    // Get user agent (Device info)
    const userAgent = req.headers['user-agent'] || null;

    // Device type detection
    let device = 'Unknown';
    if (userAgent) {
      if (/Mobile|Android|iPhone|iPad|iPod/i.test(userAgent)) {
        device = 'Mobile';
      } else if (/Tablet|iPad/i.test(userAgent)) {
        device = 'Tablet';
      } else {
        device = 'Desktop';
      }
    }

    // TODO: Implement location detection (get location from IP address)
    const location = null;

    return { ipAddress, userAgent, device, location };
  }

  // Function to record login attempt
  private async recordLoginAttempt(userId: string, req: Request, successful: boolean) {
    const { ipAddress, userAgent, device, location } = this.extractDeviceInfo(req);

    await this.prisma.loginHistory.create({
      data: {
        userId,
        ipAddress,
        userAgent,
        device,
        location,
        successful,
        loginTime: new Date()
      }
    });
  }

  // Signup method
  public async signup(firstName: string, lastName: string, email: string, password: string) {
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, this.saltRounds);

    // Generate OTP and set expiry time
    const verificationCode = generateOTP();
    const codeExpiry = this.generateCodeExpiry();

    try {
      await sendVerificationEmail(
        email,
        verificationCode,
        firstName
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Error sending verification email: ${errorMessage}`);
    }

    const newUser = await this.prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        password: hashedPassword,
        verificationCode,
        codeExpiry,
        isVerified: false
      },
    });

    return {
      status: "success",
      statusCode: 201,
      message: "User registered successfully",
      data: {
        user: {
          id: newUser.id,
          firstName,
          lastName,
          email,
          role: newUser.role,
          isVerified: newUser.isVerified
        },
      },
    };
  }

  // Signin method with login history
  public async signin(email: string, password: string, req: Request) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      const existingEmail = await this.prisma.user.findFirst({
        where: { email },
        select: { id: true }
      });

      if (existingEmail) {
        await this.recordLoginAttempt(existingEmail.id, req, false);
      }

      throw new Error("Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await this.recordLoginAttempt(user.id, req, false);
      throw new Error("Invalid email or password");
    }

    // Check if user is verified
    if (!user.isVerified) {
      throw new Error("Account not verified. Please verify your email address.");
    }

    // Check if 2FA is enabled
    if (user.totpEnabled) {
      // Return a special response indicating 2FA is required
      return {
        status: "pending",
        statusCode: 200,
        message: "2FA verification required",
        data: {
          requiresOtp: true,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName
          }
        }
      };
    }

    // Regular flow for users without 2FA
    await this.recordLoginAttempt(user.id, req, true);

    const accessToken = generateAccessToken(user.id, user.role);
    const refreshToken = generateRefreshToken(user.id, user.role);

    return {
      status: "success",
      statusCode: 200,
      message: "User signed in successfully",
      data: {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          totpEnabled: user.totpEnabled
        },
        accessToken,
        refreshToken,
      },
    };
  }

  // Get login history for a user
  public async getLoginHistory(userId: string) {
    const loginHistory = await this.prisma.loginHistory.findMany({
      where: { userId: userId },
      orderBy: { loginTime: 'desc' },
    });

    return loginHistory;
  }

  // Refresh access token method
  public async refreshAccessToken(refreshToken: string) {
    try {
      const decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET as string
      ) as jwt.JwtPayload;

      const newAccessToken = generateAccessToken(decoded.userId, decoded.role);

      return newAccessToken;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new Error("Refresh token expired");
      }
      throw new Error("Error refreshing access token");
    }
  }

  // Verify email with OTP
  public async verifyEmail(email: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.isVerified) {
      throw new Error("Email already verified");
    }

    if (!user.verificationCode || !user.codeExpiry) {
      throw new Error("Verification code not found or expired");
    }

    if (user.verificationCode !== code) {
      throw new Error("Invalid verification code");
    }

    if (new Date() > user.codeExpiry) {
      throw new Error("Verification code has expired");
    }

    // Update user verification status (make isVerified = true)
    const verifiedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verificationCode: null,
        codeExpiry: null
      }
    });

    return {
      status: "success",
      statusCode: 200,
      message: "Email verified successfully",
      data: {
        user: {
          id: verifiedUser.id,
          firstName: verifiedUser.firstName,
          lastName: verifiedUser.lastName,
          email: verifiedUser.email,
          isVerified: verifiedUser.isVerified
        }
      }
    };
  }

  // Resend verification code
  public async resendVerificationCode(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.isVerified) {
      throw new Error("Email already verified");
    }

    // Generate OTP and set expiry time
    const verificationCode = generateOTP();
    const codeExpiry = this.generateCodeExpiry();

    // Update user with new verification code
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verificationCode,
        codeExpiry
      }
    });

    // Send verification email
    await sendVerificationEmail(
      email,
      verificationCode,
      user.firstName
    );

    return {
      status: "success",
      statusCode: 200,
      message: "Verification code resent successfully"
    };
  }

  // Forgot password method
  public async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error("User not found");
    }

    // Generate reset token and set expiry time
    const resetPasswordCode = generateOTP();
    const resetPasswordExpiry = this.generateCodeExpiry();

    // Update user with reset token
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordCode,
        resetPasswordExpiry
      }
    });

    // Send password reset email
    await sendPasswordResetEmail(
      email,
      resetPasswordCode,
      user.firstName
    );

    return {
      status: "success",
      statusCode: 200,
      message: "Password reset instructions sent to your email"
    };
  }

  // Reset password method
  public async resetPassword(email: string, code: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.resetPasswordCode || !user.resetPasswordExpiry) {
      throw new Error("Reset code not found or expired");
    }

    if (user.resetPasswordCode !== code) {
      throw new Error("Invalid reset code");
    }

    if (new Date() > user.resetPasswordExpiry) {
      throw new Error("Reset code has expired");
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, this.saltRounds);

    // Update user password and clear reset token
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordCode: null,
        resetPasswordExpiry: null
      }
    });

    return {
      status: "success",
      statusCode: 200,
      message: "Password reset successful"
    };
  }

  // Setup 2FA for a user - generates secret and QR code
  public async setup2FA(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.totpEnabled) {
      throw new Error("2FA is already enabled for this account");
    }

    // Generate TOTP secret
    const { secret, otpauth_url } = generateTOTPSecret(user.email);

    // Generate QR code
    const qrCode = await generateQRCode(otpauth_url);

    // Store the secret temporarily (it will be confirmed before enabling)
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: secret,
        // Not enabled yet until verified with a token
        totpEnabled: false
      }
    });

    return {
      status: "success",
      statusCode: 200,
      message: "2FA setup initiated",
      data: {
        secret: secret, // User should store this as backup
        qrCode: qrCode
      }
    };
  }

  // Verify and enable 2FA
  public async verify2FA(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.totpEnabled) {
      throw new Error("2FA is already enabled");
    }

    if (!user.totpSecret) {
      throw new Error("2FA setup not initiated");
    }

    // Verify token with stored secret
    const isValid = verifyTOTP(token, user.totpSecret);

    if (!isValid) {
      throw new Error("Invalid 2FA token");
    }

    // Enable 2FA for the user
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled: true
      }
    });

    return {
      status: "success",
      statusCode: 200,
      message: "2FA enabled successfully"
    };
  }

  // Signin with 2FA
  public async signin2FA(email: string, password: string, token: string, req: Request) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error("Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await this.recordLoginAttempt(user.id, req, false);
      throw new Error("Invalid email or password");
    }

    // Check if user is verified
    if (!user.isVerified) {
      throw new Error("Account not verified. Please verify your email address.");
    }

    // Verify 2FA token if 2FA is enabled
    if (user.totpEnabled) {
      if (!token) {
        throw new Error("2FA token required");
      }

      if (!user.totpSecret) {
        throw new Error("2FA not properly configured");
      }

      const isValid = verifyTOTP(token, user.totpSecret);
      if (!isValid) {
        await this.recordLoginAttempt(user.id, req, false);
        throw new Error("Invalid 2FA token");
      }
    }

    // Record successful login attempt
    await this.recordLoginAttempt(user.id, req, true);

    // Generate access and refresh tokens
    const accessToken = generateAccessToken(user.id, user.role);
    const refreshToken = generateRefreshToken(user.id, user.role);

    return {
      status: "success",
      statusCode: 200,
      message: "User signed in successfully",
      data: {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          totpEnabled: user.totpEnabled
        },
        accessToken,
        refreshToken,
      },
    };
  }

  // Disable 2FA
  public async disable2FA(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (!user.totpEnabled) {
      throw new Error("2FA is not enabled for this account");
    }

    if (!user.totpSecret) {
      throw new Error("2FA not properly configured");
    }

    // Verify token before disabling
    const isValid = verifyTOTP(token, user.totpSecret);
    if (!isValid) {
      throw new Error("Invalid 2FA token");
    }

    // Disable 2FA
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: null,
        totpEnabled: false
      }
    });

    return {
      status: "success",
      statusCode: 200,
      message: "2FA disabled successfully"
    };
  }
}