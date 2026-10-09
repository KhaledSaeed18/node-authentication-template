import { z } from 'zod';
import { createDocument, type ZodOpenApiOperationObject, type ZodOpenApiPathsObject } from 'zod-openapi';
import { env } from '../config/env.js';
import {
    changePasswordSchema,
    disable2FASchema,
    forgotPasswordSchema,
    refreshTokenSchema,
    regenerateRecoveryCodesSchema,
    resendVerificationSchema,
    resetPasswordSchema,
    sessionIdParamsSchema,
    signin2FASchema,
    signinSchema,
    signupSchema,
    verify2FASchema,
    verifyEmailSchema,
} from '../modules/auth/auth.schemas.js';
import { updateProfileSchema } from '../modules/users/users.schemas.js';
import { paginationQuerySchema } from '../shared/validation/pagination.js';

// Request schemas come straight from the validation layer, so the docs can't drift from it

const user = z
    .object({
        id: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        email: z.email(),
        role: z.enum(['USER', 'ADMIN']),
        isVerified: z.boolean(),
        totpEnabled: z.boolean(),
        createdAt: z.iso.datetime(),
    })
    .meta({ id: 'User' });

const tokens = z.object({
    accessToken: z.string().meta({ description: 'Short-lived JWT, send as "Authorization: Bearer <token>"' }),
    refreshToken: z.string().meta({ description: 'Opaque token, rotated on every refresh' }),
});

const session = z
    .object({
        id: z.string(),
        ipAddress: z.string().nullable(),
        userAgent: z.string().nullable(),
        createdAt: z.iso.datetime(),
        lastUsedAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        current: z.boolean(),
    })
    .meta({ id: 'Session' });

const loginAttempt = z
    .object({
        id: z.string(),
        ipAddress: z.string().nullable(),
        userAgent: z.string().nullable(),
        device: z.string().nullable(),
        location: z.string().nullable(),
        loginTime: z.iso.datetime(),
        successful: z.boolean(),
    })
    .meta({ id: 'LoginAttempt' });

const recoveryCodes = z.object({
    recoveryCodes: z.array(z.string()).meta({ description: 'Shown only once, store them somewhere safe' }),
});

const errorResponse = z
    .object({
        status: z.enum(['fail', 'error']),
        statusCode: z.number(),
        code: z.string().meta({ description: 'Stable machine-readable error code, e.g. INVALID_CREDENTIALS' }),
        message: z.string(),
        validationErrors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
    })
    .meta({ id: 'Error' });

const success = (description: string, data?: z.ZodType) => ({
    description,
    content: {
        'application/json': {
            schema: z.object({
                status: z.literal('success'),
                statusCode: z.number(),
                message: z.string(),
                ...(data && { data }),
            }),
        },
    },
});

const error = (description: string) => ({ description, content: { 'application/json': { schema: errorResponse } } });

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });

const commonErrors = {
    '400': error('Validation failed'),
    '429': error('Rate limit exceeded'),
};

const authenticated = { security: [{ bearerAuth: [] }] };

const operation = (op: ZodOpenApiOperationObject): ZodOpenApiOperationObject => ({
    ...op,
    responses: { ...commonErrors, ...op.responses },
});

const paths: ZodOpenApiPathsObject = {
    '/auth/signup': {
        post: operation({
            tags: ['Auth'],
            summary: 'Create an account and email a verification code',
            requestBody: json(signupSchema),
            responses: { '201': success('Account created', z.object({ user })), '409': error('Email already registered') },
        }),
    },
    '/auth/verify-email': {
        post: operation({
            tags: ['Auth'],
            summary: 'Verify the email address with the emailed code',
            requestBody: json(verifyEmailSchema),
            responses: { '200': success('Email verified', z.object({ user })) },
        }),
    },
    '/auth/resend-verification': {
        post: operation({
            tags: ['Auth'],
            summary: 'Send a new verification code',
            description: 'Always answers the same way, whether or not the account exists.',
            requestBody: json(resendVerificationSchema),
            responses: { '200': success('Request accepted') },
        }),
    },
    '/auth/signin': {
        post: operation({
            tags: ['Auth'],
            summary: 'Sign in with email and password',
            description:
                'Returns tokens, or `{ requiresTwoFactor: true, mfaToken }` when 2FA is enabled; finish with /auth/2fa/signin.',
            requestBody: json(signinSchema),
            responses: {
                '200': success(
                    'Signed in, or a second factor is required',
                    z.union([
                        tokens.extend({ requiresTwoFactor: z.literal(false), user }),
                        z.object({ requiresTwoFactor: z.literal(true), mfaToken: z.string() }),
                    ])
                ),
                '401': error('Invalid email or password'),
                '403': error('Email not verified'),
            },
        }),
    },
    '/auth/2fa/signin': {
        post: operation({
            tags: ['Two-factor'],
            summary: 'Complete a 2FA signin with an authenticator or recovery code',
            requestBody: json(signin2FASchema),
            responses: { '200': success('Signed in', tokens.extend({ user })), '401': error('Invalid code or expired mfaToken') },
        }),
    },
    '/auth/refresh-token': {
        post: operation({
            tags: ['Sessions'],
            summary: 'Exchange a refresh token for a new token pair',
            description: 'Reusing an already rotated refresh token revokes the whole session.',
            requestBody: json(refreshTokenSchema),
            responses: { '200': success('New tokens', tokens), '401': error('Invalid, expired or reused refresh token') },
        }),
    },
    '/auth/logout': {
        post: operation({
            ...authenticated,
            tags: ['Sessions'],
            summary: 'End the current session',
            responses: { '200': success('Signed out'), '401': error('Not authenticated') },
        }),
    },
    '/auth/logout-all': {
        post: operation({
            ...authenticated,
            tags: ['Sessions'],
            summary: 'End every session of the user',
            responses: { '200': success('Signed out everywhere', z.object({ revokedSessions: z.number() })) },
        }),
    },
    '/auth/sessions': {
        get: operation({
            ...authenticated,
            tags: ['Sessions'],
            summary: 'List active sessions',
            responses: { '200': success('Active sessions', z.object({ sessions: z.array(session) })) },
        }),
    },
    '/auth/sessions/{sessionId}': {
        delete: operation({
            ...authenticated,
            tags: ['Sessions'],
            summary: 'End one of your sessions',
            requestParams: { path: sessionIdParamsSchema },
            responses: { '200': success('Session ended'), '404': error('Session not found') },
        }),
    },
    '/auth/login-history': {
        get: operation({
            ...authenticated,
            tags: ['Sessions'],
            summary: 'Sign-in attempts, newest first',
            requestParams: { query: paginationQuerySchema },
            responses: {
                '200': success(
                    'A page of login attempts',
                    z.object({ loginHistory: z.array(loginAttempt), nextCursor: z.string().nullable() })
                ),
            },
        }),
    },
    '/auth/forgot-password': {
        post: operation({
            tags: ['Password'],
            summary: 'Email a password reset code',
            description: 'Always answers the same way, whether or not the account exists.',
            requestBody: json(forgotPasswordSchema),
            responses: { '200': success('Request accepted') },
        }),
    },
    '/auth/reset-password': {
        post: operation({
            tags: ['Password'],
            summary: 'Set a new password with the emailed code (signs out every session)',
            requestBody: json(resetPasswordSchema),
            responses: { '200': success('Password reset') },
        }),
    },
    '/auth/change-password': {
        post: operation({
            ...authenticated,
            tags: ['Password'],
            summary: 'Change the password (signs out other sessions)',
            requestBody: json(changePasswordSchema),
            responses: { '200': success('Password changed') },
        }),
    },
    '/auth/2fa/setup': {
        post: operation({
            ...authenticated,
            tags: ['Two-factor'],
            summary: 'Start 2FA setup: returns the secret and a QR code',
            responses: {
                '200': success('Setup started', z.object({ secret: z.string(), qrCode: z.string().meta({ description: 'PNG data URL' }) })),
            },
        }),
    },
    '/auth/2fa/verify': {
        post: operation({
            ...authenticated,
            tags: ['Two-factor'],
            summary: 'Confirm setup with a code and turn 2FA on',
            requestBody: json(verify2FASchema),
            responses: { '200': success('2FA enabled', recoveryCodes) },
        }),
    },
    '/auth/2fa/recovery-codes': {
        post: operation({
            ...authenticated,
            tags: ['Two-factor'],
            summary: 'Replace the recovery codes',
            requestBody: json(regenerateRecoveryCodesSchema),
            responses: { '200': success('New recovery codes', recoveryCodes) },
        }),
    },
    '/auth/2fa/disable': {
        post: operation({
            ...authenticated,
            tags: ['Two-factor'],
            summary: 'Turn 2FA off with an authenticator or recovery code',
            requestBody: json(disable2FASchema),
            responses: { '200': success('2FA disabled') },
        }),
    },
    '/users/me': {
        get: operation({
            ...authenticated,
            tags: ['Users'],
            summary: 'Current user profile',
            responses: { '200': success('Profile', z.object({ user })) },
        }),
        patch: operation({
            ...authenticated,
            tags: ['Users'],
            summary: 'Update first and/or last name',
            requestBody: json(updateProfileSchema),
            responses: { '200': success('Updated profile', z.object({ user })) },
        }),
    },
    '/users': {
        get: operation({
            ...authenticated,
            tags: ['Users'],
            summary: 'List users (ADMIN only)',
            requestParams: { query: paginationQuerySchema },
            responses: {
                '200': success('A page of users', z.object({ users: z.array(user), nextCursor: z.string().nullable() })),
                '403': error('Not an admin'),
            },
        }),
    },
};

export const createOpenApiDocument = () =>
    createDocument({
        openapi: '3.1.0',
        info: {
            title: `${env.APP_NAME} API`,
            version: '2.0.0',
            description:
                'Authentication API: email verification, password reset, TOTP 2FA with recovery codes, rotating refresh tokens and session management.',
        },
        servers: [{ url: `${env.BASE_URL}/${env.API_VERSION}` }],
        components: {
            securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        },
        paths,
    });
