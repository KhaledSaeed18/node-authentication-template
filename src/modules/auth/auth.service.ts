import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { PrismaClient, User } from '../../generated/prisma/client.js';
import type { Mailer } from '../../mail/mailer.js';
import { passwordResetEmail, verificationEmail } from '../../mail/templates.js';
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    TooManyRequestsError,
    UnauthorizedError,
} from '../../shared/errors/app-error.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import type {
    ResetPasswordInput,
    Signin2FAInput,
    SigninInput,
    SignupInput,
    VerifyEmailInput,
} from './auth.schemas.js';
import { generateAccessToken, generateRefreshToken } from './tokens.js';
import { generateQRCode, generateTOTPSecret, verifyTOTP } from './totp.js';
import { CODE_TTL_MINUTES, VerificationCodeService } from './verification-code.service.js';

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
    constructor(
        private readonly db: PrismaClient,
        private readonly mailer: Mailer,
        private readonly codes: VerificationCodeService
    ) {}

    private async sendVerificationCode(user: User) {
        const code = await this.codes.issue(user.id, 'EMAIL_VERIFICATION');
        await this.mailer.send(
            user.email,
            verificationEmail({ appName: env.APP_NAME, name: user.firstName, code, minutes: CODE_TTL_MINUTES })
        );
    }

    // Fire and forget; failures (including the resend cooldown) are only logged
    private inBackground(task: string, work: () => Promise<void>) {
        work().catch((error) => {
            if (error instanceof TooManyRequestsError) return;
            logger.error({ err: error }, `Background task failed: ${task}`);
        });
    }

    // Verifies the password and upgrades the stored hash if it uses older settings
    private async checkPassword(user: User, password: string): Promise<boolean> {
        const { valid, needsRehash } = await verifyPassword(user.password, password);
        if (valid && needsRehash) {
            await this.db.user.update({ where: { id: user.id }, data: { password: await hashPassword(password) } });
        }
        return valid;
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

        const user = await this.db.user.create({
            data: { firstName, lastName, email, password: await hashPassword(password) },
        });

        // The account exists either way; if the email fails the user can ask for a new code
        try {
            await this.sendVerificationCode(user);
        } catch (error) {
            logger.error({ err: error, userId: user.id }, 'Failed to send the verification email');
        }

        return toPublicUser(user);
    }

    async signin({ email, password }: SigninInput, context: RequestContext): Promise<SigninResult> {
        const user = await this.db.user.findUnique({ where: { email } });
        if (!user) throw invalidCredentials();

        if (!(await this.checkPassword(user, password))) {
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

    // Unknown email, already verified and wrong code all get the same answer,
    // so this endpoint can't be used to find out which emails have an account
    async verifyEmail({ email, code }: VerifyEmailInput): Promise<PublicUser> {
        const user = await this.db.user.findUnique({ where: { email } });

        if (!user || user.isVerified || !(await this.codes.consume(user.id, 'EMAIL_VERIFICATION', code))) {
            throw new BadRequestError('Invalid or expired verification code', 'INVALID_CODE');
        }

        const verifiedUser = await this.db.user.update({
            where: { id: user.id },
            data: { isVerified: true },
        });

        return toPublicUser(verifiedUser);
    }

    // Always resolves the same way whether or not the email has an account.
    // The work runs in the background so response times don't give it away either.
    async resendVerificationCode(email: string): Promise<void> {
        this.inBackground('resend verification code', async () => {
            const user = await this.db.user.findUnique({ where: { email } });
            if (user && !user.isVerified) await this.sendVerificationCode(user);
        });
    }

    // Same idea as resendVerificationCode: no way to tell if the account exists
    async forgotPassword(email: string): Promise<void> {
        this.inBackground('send password reset code', async () => {
            const user = await this.db.user.findUnique({ where: { email } });
            if (!user) return;

            const code = await this.codes.issue(user.id, 'PASSWORD_RESET');
            await this.mailer.send(
                email,
                passwordResetEmail({ appName: env.APP_NAME, name: user.firstName, code, minutes: CODE_TTL_MINUTES })
            );
        });
    }

    async resetPassword({ email, code, newPassword }: ResetPasswordInput): Promise<void> {
        const user = await this.db.user.findUnique({ where: { email } });

        if (!user || !(await this.codes.consume(user.id, 'PASSWORD_RESET', code))) {
            throw new BadRequestError('Invalid or expired reset code', 'INVALID_CODE');
        }

        await this.db.user.update({
            where: { id: user.id },
            data: { password: await hashPassword(newPassword) },
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

        if (!(await this.checkPassword(user, password))) {
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
