import { z } from 'zod';
import { BLOCKED_DOMAINS, COMMON_PASSWORDS } from './auth.constants.js';

// Trim and lowercase first, then check the format (z.email() alone rejects surrounding
// spaces). Lowercasing keeps one account per address regardless of how it's typed.
const emailField = (message: string) => z.string().trim().toLowerCase().pipe(z.email(message));

// Refinements still run when the email format check fails, so don't assume an "@"
const isAllowedDomain = (email: string) => {
    const domain = email.split('@').pop()?.toLowerCase();
    return !domain || !BLOCKED_DOMAINS.includes(domain);
};

// Password rules for every new password (signup, reset, change)
const passwordField = z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .max(64, "Password cannot exceed 64 characters")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character")
    .refine(
        (password) => !COMMON_PASSWORDS.includes(password),
        "This password is too common. Please choose a more unique password."
    );

// Signup schema
export const signupSchema = z.object({
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

    password: passwordField,
});

// Signin schema
export const signinSchema = z.object({
    email: z.string()
        .trim()
        .min(1, "Email is required")
        .toLowerCase()
        .pipe(z.email("Please enter a valid email address")),

    password: z.string()
        .min(1, "Password is required")
        .max(64, "Password exceeds maximum length")
});

// Refresh token schema
export const refreshTokenSchema = z.object({
    refreshToken: z.string()
        .min(1, "Refresh token is required")
});

// Email verification schema
export const verifyEmailSchema = z.object({
    email: emailField("Invalid email format"),

    code: z.string()
        .trim()
        .length(6, "Verification code must be 6 digits")
        .regex(/^\d{6}$/, "Verification code must contain only digits")
});

// Resend verification schema
export const resendVerificationSchema = z.object({
    email: emailField("Invalid email format")
});

// Forgot password schema
export const forgotPasswordSchema = z.object({
    email: emailField("Invalid email format")
});

// Reset password schema
export const resetPasswordSchema = z.object({
    email: emailField("Invalid email format"),

    code: z.string()
        .trim()
        .length(6, "Reset code must be 6 digits")
        .regex(/^\d{6}$/, "Reset code must contain only digits"),

    newPassword: passwordField,
});

// Verify & Enable 2FA schema
export const verify2FASchema = z.object({
    token: z.string()
        .trim()
        .min(6, "Token must be at least 6 characters")
        .max(6, "Token must be at most 6 characters")
        .regex(/^\d+$/, "Token must contain only digits"),
});

// Validate 2FA token schema (for login)
export const signin2FASchema = z.object({
    email: emailField("Invalid email format"),
    token: z.string()
        .trim()
        .min(6, "Token must be at least 6 characters")
        .max(6, "Token must be at most 6 characters")
        .regex(/^\d+$/, "Token must contain only digits"),
    password: z.string().min(1, "Password is required"),
});

// Disable 2FA schema
export const disable2FASchema = z.object({
    token: z.string()
        .trim()
        .min(6, "Token must be at least 6 characters")
        .max(6, "Token must be at most 6 characters")
        .regex(/^\d+$/, "Token must contain only digits"),
});

export const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1, "Current password is required").max(64),
        newPassword: passwordField,
    })
    .refine((data) => data.currentPassword !== data.newPassword, {
        path: ['newPassword'],
        message: 'New password must be different from the current one',
    });

export const sessionIdParamsSchema = z.object({
    sessionId: z.string().trim().min(1).max(64),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SigninInput = z.infer<typeof signinSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type Verify2FAInput = z.infer<typeof verify2FASchema>;
export type Signin2FAInput = z.infer<typeof signin2FASchema>;
export type Disable2FAInput = z.infer<typeof disable2FASchema>;
