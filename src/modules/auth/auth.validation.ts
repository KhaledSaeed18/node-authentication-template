import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../shared/errors/app-error.js';
import { BLOCKED_DOMAINS, COMMON_PASSWORDS } from './auth.constants.js';

// Trim first, then check the format (z.email() alone rejects surrounding spaces)
const emailField = (message: string) => z.string().trim().pipe(z.email(message));

// Refinements still run when the email format check fails, so don't assume an "@"
const isAllowedDomain = (email: string) => {
    const domain = email.split('@').pop()?.toLowerCase();
    return !domain || !BLOCKED_DOMAINS.includes(domain);
};

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

    email: emailField("Invalid email format")
        .refine(isAllowedDomain, "This email domain is not allowed. Please use a different email address"),

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
        .pipe(z.email("Please enter a valid email address")),

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
    email: emailField("Invalid email format"),

    code: z.string()
        .trim()
        .length(6, "Verification code must be 6 digits")
        .regex(/^\d{6}$/, "Verification code must contain only digits")
});

// Resend verification schema
const resendVerificationSchema = z.object({
    email: emailField("Invalid email format")
});

// Forgot password schema
const forgotPasswordSchema = z.object({
    email: emailField("Invalid email format")
});

// Reset password schema
const resetPasswordSchema = z.object({
    email: emailField("Invalid email format"),

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
    email: emailField("Invalid email format"),
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

// Validation middleware, replaces req.body with the parsed (trimmed, stripped) data
const validate = (schema: z.ZodType) => (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
        const validationErrors = result.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
        }));

        return next(new ValidationError(validationErrors));
    }

    req.body = result.data;
    next();
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