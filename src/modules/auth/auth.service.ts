import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { PrismaClient, User } from '../../generated/prisma/client.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../../mail/email.js';
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
} from '../../shared/errors/app-error.js';
import { generateOTP } from '../../shared/utils/otp.js';
import type {
    ResetPasswordInput,
    Signin2FAInput,
    SigninInput,
    SignupInput,
    VerifyEmailInput,
} from './auth.schemas.js';
import { generateAccessToken, generateRefreshToken } from './tokens.js';
import { generateQRCode, generateTOTPSecret, verifyTOTP } from './totp.js';

const CODE_TTL_MS = 15 * 60 * 1000;

// Where a request came from, recorded in the login history
export interface RequestContext {
    ipAddress: string | null;
    userAgent: string | null;
}

export type PublicUser = Pick<User, 'id' | 'firstName' | 'lastName' | 'email' | 'role' | 'isVerified' | 'totpEnabled'>;

export type SigninResult =
    | { requiresOtp: true; user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName'> }
    | { requiresOtp: false; user: PublicUser; accessToken: string; refreshToken: string };

export const toPublicUser = (user: User): PublicUser => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    isVerified: user.isVerified,
    totpEnabled: user.totpEnabled,
});

const detectDevice = (userAgent: string | null): string => {
    if (!userAgent) return 'Unknown';
    if (/Mobile|Android|iPhone|iPad|iPod/i.test(userAgent)) return 'Mobile';
    if (/Tablet|iPad/i.test(userAgent)) return 'Tablet';
    return 'Desktop';
};

const invalidCredentials = () => new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
const notVerified = () =>
    new ForbiddenError('Account not verified. Please verify your email address.', 'EMAIL_NOT_VERIFIED');
const userNotFound = () => new NotFoundError('User not found', 'USER_NOT_FOUND');

export class AuthService {
    constructor(private readonly db: PrismaClient) {}

    private codeExpiry(): Date {
        return new Date(Date.now() + CODE_TTL_MS);
    }

    private async recordLoginAttempt(userId: string, context: RequestContext, successful: boolean) {
        await this.db.loginHistory.create({
            data: {
                userId,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                device: detectDevice(context.userAgent),
                location: null,
                successful,
            },
        });
    }

    private issueTokens(user: User) {
        return {
            accessToken: generateAccessToken(user.id, user.role),
            refreshToken: generateRefreshToken(user.id, user.role),
        };
    }

    private async findUserById(userId: string): Promise<User> {
        const user = await this.db.user.findUnique({ where: { id: userId } });
        if (!user) throw userNotFound();
        return user;
    }

    async signup({ firstName, lastName, email, password }: SignupInput): Promise<PublicUser> {
        const existingUser = await this.db.user.findUnique({ where: { email } });
        if (existingUser) {
            throw new ConflictError('User with this email already exists', 'EMAIL_TAKEN');
        }

        const hashedPassword = await bcrypt.hash(password, env.SALT_ROUNDS);
        const verificationCode = generateOTP();

        await sendVerificationEmail(email, verificationCode, firstName);

        const user = await this.db.user.create({
            data: {
                firstName,
                lastName,
                email,
                password: hashedPassword,
                verificationCode,
                codeExpiry: this.codeExpiry(),
            },
        });

        return toPublicUser(user);
    }

    async signin({ email, password }: SigninInput, context: RequestContext): Promise<SigninResult> {
        const user = await this.db.user.findUnique({ where: { email } });
        if (!user) throw invalidCredentials();

        if (!(await bcrypt.compare(password, user.password))) {
            await this.recordLoginAttempt(user.id, context, false);
            throw invalidCredentials();
        }

        if (!user.isVerified) throw notVerified();

        if (user.totpEnabled) {
            return {
                requiresOtp: true,
                user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
            };
        }

        await this.recordLoginAttempt(user.id, context, true);

        return { requiresOtp: false, user: toPublicUser(user), ...this.issueTokens(user) };
    }

    async getLoginHistory(userId: string) {
        return this.db.loginHistory.findMany({
            where: { userId },
            orderBy: { loginTime: 'desc' },
        });
    }

    refreshAccessToken(refreshToken: string): string {
        try {
            const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
            return generateAccessToken(decoded.userId, decoded.role);
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new UnauthorizedError('Refresh token expired', 'TOKEN_EXPIRED');
            }
            throw new UnauthorizedError('Invalid refresh token', 'INVALID_TOKEN');
        }
    }

    async verifyEmail({ email, code }: VerifyEmailInput): Promise<PublicUser> {
        const user = await this.db.user.findUnique({ where: { email } });
        if (!user) throw userNotFound();
        if (user.isVerified) throw new BadRequestError('Email already verified', 'EMAIL_ALREADY_VERIFIED');

        if (!user.verificationCode || !user.codeExpiry || user.verificationCode !== code) {
            throw new BadRequestError('Invalid verification code', 'INVALID_CODE');
        }
        if (new Date() > user.codeExpiry) {
            throw new BadRequestError('Verification code has expired', 'CODE_EXPIRED');
        }

        const verifiedUser = await this.db.user.update({
            where: { id: user.id },
            data: { isVerified: true, verificationCode: null, codeExpiry: null },
        });

        return toPublicUser(verifiedUser);
    }

    async resendVerificationCode(email: string): Promise<void> {
        const user = await this.db.user.findUnique({ where: { email } });
        if (!user) throw userNotFound();
        if (user.isVerified) throw new BadRequestError('Email already verified', 'EMAIL_ALREADY_VERIFIED');

        const verificationCode = generateOTP();
        await this.db.user.update({
            where: { id: user.id },
            data: { verificationCode, codeExpiry: this.codeExpiry() },
        });

        await sendVerificationEmail(email, verificationCode, user.firstName);
    }

    async forgotPassword(email: string): Promise<void> {
        const user = await this.db.user.findUnique({ where: { email } });
        if (!user) throw userNotFound();

        const resetPasswordCode = generateOTP();
        await this.db.user.update({
            where: { id: user.id },
            data: { resetPasswordCode, resetPasswordExpiry: this.codeExpiry() },
        });

        await sendPasswordResetEmail(email, resetPasswordCode, user.firstName);
    }

    async resetPassword({ email, code, newPassword }: ResetPasswordInput): Promise<void> {
        const user = await this.db.user.findUnique({ where: { email } });
        if (!user) throw userNotFound();

        if (!user.resetPasswordCode || !user.resetPasswordExpiry) {
            throw new BadRequestError('No active reset request found', 'NO_RESET_REQUEST');
        }
        if (user.resetPasswordCode !== code) {
            throw new BadRequestError('Invalid reset code', 'INVALID_CODE');
        }
        if (new Date() > user.resetPasswordExpiry) {
            throw new BadRequestError('Reset code has expired', 'CODE_EXPIRED');
        }

        await this.db.user.update({
            where: { id: user.id },
            data: {
                password: await bcrypt.hash(newPassword, env.SALT_ROUNDS),
                resetPasswordCode: null,
                resetPasswordExpiry: null,
            },
        });
    }

    async setup2FA(userId: string): Promise<{ secret: string; qrCode: string }> {
        const user = await this.findUserById(userId);
        if (user.totpEnabled) {
            throw new BadRequestError('2FA is already enabled for this account', 'TWO_FACTOR_ALREADY_ENABLED');
        }

        const { secret, otpauth_url } = generateTOTPSecret(user.email);
        const qrCode = await generateQRCode(otpauth_url);

        // Stored but not active until confirmed with a valid code
        await this.db.user.update({
            where: { id: userId },
            data: { totpSecret: secret, totpEnabled: false },
        });

        return { secret, qrCode };
    }

    async verify2FA(userId: string, token: string): Promise<void> {
        const user = await this.findUserById(userId);
        if (user.totpEnabled) {
            throw new BadRequestError('2FA is already enabled', 'TWO_FACTOR_ALREADY_ENABLED');
        }
        if (!user.totpSecret) {
            throw new BadRequestError('2FA setup not initiated', 'TWO_FACTOR_NOT_INITIATED');
        }
        if (!(await verifyTOTP(token, user.totpSecret))) {
            throw new BadRequestError('Invalid 2FA token', 'INVALID_TWO_FACTOR_CODE');
        }

        await this.db.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    }

    async signin2FA({ email, password, token }: Signin2FAInput, context: RequestContext) {
        const user = await this.db.user.findUnique({ where: { email } });
        if (!user) throw invalidCredentials();

        if (!(await bcrypt.compare(password, user.password))) {
            await this.recordLoginAttempt(user.id, context, false);
            throw invalidCredentials();
        }

        if (!user.isVerified) throw notVerified();

        if (user.totpEnabled) {
            if (!user.totpSecret || !(await verifyTOTP(token, user.totpSecret))) {
                await this.recordLoginAttempt(user.id, context, false);
                throw new UnauthorizedError('Invalid 2FA token', 'INVALID_TWO_FACTOR_CODE');
            }
        }

        await this.recordLoginAttempt(user.id, context, true);

        return { user: toPublicUser(user), ...this.issueTokens(user) };
    }

    async disable2FA(userId: string, token: string): Promise<void> {
        const user = await this.findUserById(userId);
        if (!user.totpEnabled || !user.totpSecret) {
            throw new BadRequestError('2FA is not enabled for this account', 'TWO_FACTOR_NOT_ENABLED');
        }
        if (!(await verifyTOTP(token, user.totpSecret))) {
            throw new BadRequestError('Invalid 2FA token', 'INVALID_TWO_FACTOR_CODE');
        }

        await this.db.user.update({
            where: { id: userId },
            data: { totpSecret: null, totpEnabled: false },
        });
    }
}
