import type { PrismaClient, User } from '../../generated/prisma/client.js';
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    TooManyRequestsError,
    UnauthorizedError,
} from '../../shared/errors/app-error.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../shared/utils/password.js';
import { detectDevice } from '../../shared/utils/user-agent.js';
import { type PaginationQuery, toPage } from '../../shared/validation/pagination.js';
import { enqueue, type OutboxJobs } from '../outbox/outbox.js';
import { type PublicUser, toPublicUser } from '../users/users.mapper.js';
import type {
    ChangePasswordInput,
    ResetPasswordInput,
    Signin2FAInput,
    SigninInput,
    SignupInput,
    VerifyEmailInput,
} from './auth.schemas.js';
import type { RecoveryCodeService } from './recovery-code.service.js';
import type { SessionService } from './session.service.js';
import { signAccessToken, signMfaToken, verifyMfaToken } from './tokens.js';
import { generateQRCode, generateTOTPSecret, openTOTPSecret, sealTOTPSecret, verifyTOTP } from './totp.js';
import './auth.jobs.js';
import type { VerificationCodeService } from './verification-code.service.js';

// Where a request came from, recorded in the login history
export interface RequestContext {
    ipAddress: string | null;
    userAgent: string | null;
}

export type SigninResult =
    | { requiresTwoFactor: true; mfaToken: string }
    | { requiresTwoFactor: false; user: PublicUser; accessToken: string; refreshToken: string };

const MAX_FAILED_SIGNINS = 5;
const LOCKOUT_MINUTES = 15;

const invalidCredentials = () => new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
const notVerified = () =>
    new ForbiddenError('Account not verified. Please verify your email address.', 'EMAIL_NOT_VERIFIED');
const userNotFound = () => new NotFoundError('User not found', 'USER_NOT_FOUND');

export class AuthService {
    constructor(
        private readonly db: PrismaClient,
        private readonly codes: VerificationCodeService,
        private readonly sessions: SessionService,
        private readonly recoveryCodes: RecoveryCodeService
    ) {}

    // Temporary lock after too many failed signins since the last successful one,
    // which per-IP rate limits can't catch when an attacker spreads requests
    private async assertNotLocked(userId: string) {
        const windowStart = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
        const lastSuccess = await this.db.loginHistory.findFirst({
            where: { userId, successful: true, loginTime: { gt: windowStart } },
            orderBy: { loginTime: 'desc' },
            select: { loginTime: true },
        });

        const failures = await this.db.loginHistory.count({
            where: { userId, successful: false, loginTime: { gt: lastSuccess?.loginTime ?? windowStart } },
        });

        if (failures >= MAX_FAILED_SIGNINS) {
            throw new TooManyRequestsError(
                `Too many failed sign-in attempts. Please try again in ${LOCKOUT_MINUTES} minutes.`,
                'ACCOUNT_LOCKED'
            );
        }
    }

    // Checks a TOTP code and records its time step so the same code can't be used again.
    // Legacy plaintext secrets are encrypted on first successful use.
    private async checkTOTP(user: User, token: string): Promise<boolean> {
        if (!user.totpSecret) return false;

        const secret = openTOTPSecret(user.totpSecret);
        const step = await verifyTOTP(token, secret, user.totpLastUsedStep);
        if (step === null) return false;

        // Conditional update: of two concurrent requests with the same code, only one wins
        const { count } = await this.db.user.updateMany({
            where: { id: user.id, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] },
            data: { totpLastUsedStep: step, totpSecret: sealTOTPSecret(secret) },
        });
        return count === 1;
    }

    // Accepts a 6 digit authenticator code or an unused recovery code
    private async checkSecondFactor(user: User, code: string): Promise<boolean> {
        return /^\d{6}$/.test(code) ? this.checkTOTP(user, code) : this.recoveryCodes.consume(user.id, code);
    }

    // Verifies the password and upgrades the stored hash if it uses older settings
    private async checkPassword(user: User, password: string): Promise<boolean> {
        const { valid, needsRehash } = await verifyPassword(user.password, password);
        if (valid && needsRehash) {
            await this.db.user.update({ where: { id: user.id }, data: { password: await hashPassword(password) } });
        }
        return valid;
    }

    // Security notice for the owner, enqueued in the same transaction as the change it reports
    private securityNotice(user: User, event: string, context?: RequestContext): OutboxJobs['email.security-notice'] {
        return { userId: user.id, event, occurredAt: new Date().toISOString(), ipAddress: context?.ipAddress ?? null };
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

    // Starts a new session: a short-lived access token plus a rotating refresh token
    private async startSession(user: User, context: RequestContext) {
        const { sessionId, refreshToken } = await this.sessions.create(user.id, context);
        return {
            accessToken: signAccessToken({ userId: user.id, role: user.role, sessionId }),
            refreshToken,
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

        const passwordHash = await hashPassword(password);

        // The account and its verification email are committed together: no account
        // without an email on its way, and no email for an account that wasn't created
        const user = await this.db.$transaction(async (tx) => {
            const created = await tx.user.create({ data: { firstName, lastName, email, password: passwordHash } });
            await enqueue(tx, 'email.verification', { email });
            return created;
        });

        return toPublicUser(user);
    }

    async signin({ email, password }: SigninInput, context: RequestContext): Promise<SigninResult> {
        const user = await this.db.user.findUnique({ where: { email } });
        if (!user) {
            await verifyAgainstDummy(password);
            throw invalidCredentials();
        }

        await this.assertNotLocked(user.id);

        if (!(await this.checkPassword(user, password))) {
            await this.recordLoginAttempt(user.id, context, false);
            throw invalidCredentials();
        }

        if (!user.isVerified) throw notVerified();

        // Password is right but a second factor is needed: hand out a short-lived challenge token
        if (user.totpEnabled) {
            return { requiresTwoFactor: true, mfaToken: signMfaToken(user.id) };
        }

        await this.recordLoginAttempt(user.id, context, true);

        return { requiresTwoFactor: false, user: toPublicUser(user), ...(await this.startSession(user, context)) };
    }

    async logout(sessionId: string): Promise<void> {
        await this.sessions.revoke(sessionId);
    }

    async logoutAll(userId: string): Promise<number> {
        return this.sessions.revokeAll(userId);
    }

    async listSessions(userId: string, currentSessionId: string) {
        const sessions = await this.sessions.listActive(userId);
        return sessions.map((session) => ({ ...session, current: session.id === currentSessionId }));
    }

    async revokeSession(userId: string, sessionId: string): Promise<void> {
        if (!(await this.sessions.revoke(sessionId, userId))) {
            throw new NotFoundError('Session not found', 'SESSION_NOT_FOUND');
        }
    }

    // Newest first, cursor based so deep pages stay fast
    async getLoginHistory(userId: string, { limit, cursor }: PaginationQuery) {
        const rows = await this.db.loginHistory.findMany({
            where: { userId },
            orderBy: [{ loginTime: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(cursor && { cursor: { id: cursor }, skip: 1 }),
            select: { id: true, ipAddress: true, userAgent: true, device: true, location: true, loginTime: true, successful: true },
        });
        return toPage(rows, limit);
    }

    // Rotates the refresh token and issues a new access token with the user's current role
    async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
        const { session, refreshToken: nextRefreshToken } = await this.sessions.rotate(refreshToken);
        return {
            accessToken: signAccessToken({ userId: session.userId, role: session.user.role, sessionId: session.id }),
            refreshToken: nextRefreshToken,
        };
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

    // Does exactly the same work whether or not the email has an account (one insert),
    // so neither the response nor its timing reveals it. The worker sorts it out.
    async resendVerificationCode(email: string): Promise<void> {
        await enqueue(this.db, 'email.verification', { email });
    }

    // Same idea as resendVerificationCode
    async forgotPassword(email: string): Promise<void> {
        await enqueue(this.db, 'email.password-reset', { email });
    }

    async resetPassword({ email, code, newPassword }: ResetPasswordInput, context?: RequestContext): Promise<void> {
        const user = await this.db.user.findUnique({ where: { email } });

        if (!user || !(await this.codes.consume(user.id, 'PASSWORD_RESET', code))) {
            throw new BadRequestError('Invalid or expired reset code', 'INVALID_CODE');
        }

        const passwordHash = await hashPassword(newPassword);
        await this.db.$transaction(async (tx) => {
            await tx.user.update({ where: { id: user.id }, data: { password: passwordHash } });
            await enqueue(tx, 'email.security-notice', this.securityNotice(user, 'Your password was reset', context));
        });

        // Whoever knew the old password shouldn't stay signed in
        await this.sessions.revokeAll(user.id);
    }

    // Requires the current password; keeps the current session and ends all others
    async changePassword(
        userId: string,
        currentSessionId: string,
        { currentPassword, newPassword }: ChangePasswordInput,
        context?: RequestContext
    ): Promise<void> {
        const user = await this.findUserById(userId);

        if (!(await this.checkPassword(user, currentPassword))) {
            throw new BadRequestError('Current password is incorrect', 'INVALID_PASSWORD');
        }

        const passwordHash = await hashPassword(newPassword);
        await this.db.$transaction(async (tx) => {
            await tx.user.update({ where: { id: userId }, data: { password: passwordHash } });
            await enqueue(tx, 'email.security-notice', this.securityNotice(user, 'Your password was changed', context));
        });
        await this.sessions.revokeAll(userId, currentSessionId);
    }

    async setup2FA(userId: string): Promise<{ secret: string; qrCode: string }> {
        const user = await this.findUserById(userId);
        if (user.totpEnabled) {
            throw new BadRequestError('2FA is already enabled for this account', 'TWO_FACTOR_ALREADY_ENABLED');
        }

        const { secret, otpauthUrl } = generateTOTPSecret(user.email);
        const qrCode = await generateQRCode(otpauthUrl);

        // Stored encrypted, and not active until confirmed with a valid code
        await this.db.user.update({
            where: { id: userId },
            data: { totpSecret: sealTOTPSecret(secret), totpEnabled: false, totpLastUsedStep: null },
        });

        return { secret, qrCode };
    }

    // Confirms setup with a first code, turns 2FA on and returns the recovery codes (shown once)
    async verify2FA(userId: string, code: string, context?: RequestContext): Promise<{ recoveryCodes: string[] }> {
        const user = await this.findUserById(userId);
        if (user.totpEnabled) {
            throw new BadRequestError('2FA is already enabled', 'TWO_FACTOR_ALREADY_ENABLED');
        }
        if (!user.totpSecret) {
            throw new BadRequestError('2FA setup not initiated', 'TWO_FACTOR_NOT_INITIATED');
        }
        if (!(await this.checkTOTP(user, code))) {
            throw new BadRequestError('Invalid two-factor code', 'INVALID_TWO_FACTOR_CODE');
        }

        await this.db.$transaction(async (tx) => {
            await tx.user.update({ where: { id: userId }, data: { totpEnabled: true } });
            await enqueue(tx, 'email.security-notice', this.securityNotice(user, 'Two-factor authentication was turned on', context));
        });

        return { recoveryCodes: await this.recoveryCodes.regenerate(userId) };
    }

    // Replaces the recovery codes, e.g. when they run low or may have leaked
    async regenerateRecoveryCodes(userId: string, code: string, context?: RequestContext): Promise<{ recoveryCodes: string[] }> {
        const user = await this.findUserById(userId);
        if (!user.totpEnabled) {
            throw new BadRequestError('2FA is not enabled for this account', 'TWO_FACTOR_NOT_ENABLED');
        }
        if (!(await this.checkSecondFactor(user, code))) {
            throw new BadRequestError('Invalid two-factor code', 'INVALID_TWO_FACTOR_CODE');
        }

        const recoveryCodes = await this.recoveryCodes.regenerate(userId);
        await enqueue(this.db, 'email.security-notice', this.securityNotice(user, 'New 2FA recovery codes were generated', context));
        return { recoveryCodes };
    }

    // Second step of a 2FA signin: the challenge token from signin plus a TOTP code.
    // Wrong codes count towards the account lockout.
    async signin2FA({ mfaToken, code }: Signin2FAInput, context: RequestContext) {
        const user = await this.db.user.findUnique({ where: { id: verifyMfaToken(mfaToken) } });
        if (!user?.totpEnabled) {
            throw new UnauthorizedError('Two-factor session expired, please sign in again', 'INVALID_MFA_TOKEN');
        }

        await this.assertNotLocked(user.id);

        if (!(await this.checkSecondFactor(user, code))) {
            await this.recordLoginAttempt(user.id, context, false);
            throw new UnauthorizedError('Invalid two-factor code', 'INVALID_TWO_FACTOR_CODE');
        }

        await this.recordLoginAttempt(user.id, context, true);

        return { user: toPublicUser(user), ...(await this.startSession(user, context)) };
    }

    async disable2FA(userId: string, code: string, context?: RequestContext): Promise<void> {
        const user = await this.findUserById(userId);
        if (!user.totpEnabled || !user.totpSecret) {
            throw new BadRequestError('2FA is not enabled for this account', 'TWO_FACTOR_NOT_ENABLED');
        }
        if (!(await this.checkSecondFactor(user, code))) {
            throw new BadRequestError('Invalid two-factor code', 'INVALID_TWO_FACTOR_CODE');
        }

        await this.db.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: userId },
                data: { totpSecret: null, totpEnabled: false, totpLastUsedStep: null },
            });
            await tx.recoveryCode.deleteMany({ where: { userId } });
            await enqueue(tx, 'email.security-notice', this.securityNotice(user, 'Two-factor authentication was turned off', context));
        });
    }
}
