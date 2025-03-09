import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../utils/errorHandler';
import { BLOCKED_DOMAINS, COMMON_PASSWORDS } from '../../constants/auth.constants';

// Signup schema
const signupSchema = z.object({
    firstName: z.string()
        .trim()
        .min(1, "First name is required")
        .max(50, "First name cannot exceed 50 characters")
        .regex(/^[a-zA-Z\s]+$/, "First name can only contain letters and spaces"),

    lastName: z.string()
        .trim()
        .min(1, "Last name is required")
        .max(50, "Last name cannot exceed 50 characters")
        .regex(/^[a-zA-Z\s]+$/, "Last name can only contain letters and spaces"),

    email: z.string()
        .trim()
        .email("Invalid email format")
        .refine(email => {
            const domain = email.split('@')[1];
            return !BLOCKED_DOMAINS.includes(domain.toLowerCase());
        }, "This email domain is not allowed. Please use a different email address"),

    password: z.string()
        .min(8, "Password must be at least 8 characters long")
        .max(64, "Password cannot exceed 64 characters")
        .regex(/[a-z]/, "Password must contain at least one lowercase letter")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[0-9]/, "Password must contain at least one number")
        .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character")
        .refine(
            (password) => !COMMON_PASSWORDS.includes(password),
            "This password is too common. Please choose a more unique password."
        ),
});

// Signin schema
const signinSchema = z.object({
    email: z.string()
        .trim()
        .min(1, "Email is required")
        .email("Please enter a valid email address"),

    password: z.string()
        .min(1, "Password is required")
        .max(64, "Password exceeds maximum length")
});

// Refresh token schema
const refreshTokenSchema = z.object({
    refreshToken: z.string()
        .min(1, "Refresh token is required")
});

// Email verification schema
const verifyEmailSchema = z.object({
    email: z.string()
        .trim()
        .email("Invalid email format"),

    code: z.string()
        .trim()
        .length(6, "Verification code must be 6 digits")
        .regex(/^\d{6}$/, "Verification code must contain only digits")
});

// Resend verification schema
const resendVerificationSchema = z.object({
    email: z.string()
        .trim()
        .email("Invalid email format")
});

// Forgot password schema
const forgotPasswordSchema = z.object({
    email: z.string()
        .trim()
        .email("Invalid email format")
});

// Reset password schema
const resetPasswordSchema = z.object({
    email: z.string()
        .trim()
        .email("Invalid email format"),

    code: z.string()
        .trim()
        .length(6, "Reset code must be 6 digits")
        .regex(/^\d{6}$/, "Reset code must contain only digits"),

    newPassword: z.string()
        .min(8, "New password must be at least 8 characters long")
        .max(64, "New password cannot exceed 64 characters")
        .regex(/[a-z]/, "New password must contain at least one lowercase letter")
        .regex(/[A-Z]/, "New password must contain at least one uppercase letter")
        .regex(/[0-9]/, "New password must contain at least one number")
        .regex(/[^a-zA-Z0-9]/, "New password must contain at least one special character")
        .refine(
            (password) => !COMMON_PASSWORDS.includes(password),
            "This password is too common. Please choose a more unique password."
        )
});

// Setup 2FA schema
const setup2FASchema = z.object({
    userId: z.string().trim().min(1, "User ID is required"),
});

// Verify & Enable 2FA schema
const verify2FASchema = z.object({
    token: z.string()
        .trim()
        .min(6, "Token must be at least 6 characters")
        .max(6, "Token must be at most 6 characters")
        .regex(/^\d+$/, "Token must contain only digits"),
});

// Validate 2FA token schema (for login)
const validate2FASchema = z.object({
    email: z.string().trim().email("Invalid email format"),
    token: z.string()
        .trim()
        .min(6, "Token must be at least 6 characters")
        .max(6, "Token must be at most 6 characters")
        .regex(/^\d+$/, "Token must contain only digits"),
    password: z.string().min(1, "Password is required"),
});

// Disable 2FA schema
const disable2FASchema = z.object({
    token: z.string()
        .trim()
        .min(6, "Token must be at least 6 characters")
        .max(6, "Token must be at most 6 characters")
        .regex(/^\d+$/, "Token must contain only digits"),
});

// Validation middleware
const validate = (schema: z.ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
    try {
        schema.parse(req.body);
        next();
    } catch (error) {
        if (error instanceof z.ZodError) {
            const validationErrors = error.errors.map(err => ({
                field: err.path.join('.'),
                message: err.message
            }));

            const errorMessage = "Validation failed. Please check your input.";
            return next(errorHandler(400, errorMessage, { validationErrors }));
        }
        next(errorHandler(400, "Invalid request data"));
    }
};

export const validateSignup = validate(signupSchema);
export const validateSignin = validate(signinSchema);
export const validateRefreshToken = validate(refreshTokenSchema);
export const validateVerifyEmail = validate(verifyEmailSchema);
export const validateResendVerification = validate(resendVerificationSchema);
export const validateForgotPassword = validate(forgotPasswordSchema);
export const validateResetPassword = validate(resetPasswordSchema);
export const validateSetup2FA = validate(setup2FASchema);
export const validateVerify2FA = validate(verify2FASchema);
export const validateLogin2FA = validate(validate2FASchema);
export const validateDisable2FA = validate(disable2FASchema);