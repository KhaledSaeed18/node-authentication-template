import type { PrismaClient, User } from '../../generated/prisma/client.js';
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    TooManyRequestsError,
    UnauthorizedError,
    ValidationError,
} from '../../shared/errors/app-error.js';
import type { BreachedPasswordChecker } from '../../shared/utils/breached-passwords.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../shared/utils/password.js';
import { describeUserAgent, detectDevice } from '../../shared/utils/user-agent.js';
import { recordSecurityEvent } from '../audit/security-events.js';
import { recordAccountLocked, recordSignin } from '../../lib/metrics.js';
import { type PaginationQuery, toPage } from '../../shared/validation/pagination.js';
import { enqueue, type OutboxJobs } from '../outbox/outbox.js';
import { type PublicUser, toPublicUser } from '../users/users.mapper.js';
import type {
    ChangePasswordInput,
    PasskeySigninInput,
    RegisterPasskeyInput,
    ResetPasswordInput,
    Signin2FAInput,
    SigninInput,
    SignupInput,
    VerifyEmailInput,
} from './auth.schemas.js';
import type { PasskeyService, PublicPasskey } from './passkey.service.js';
import type { RecoveryCodeService } from './recovery-code.service.js';
import type { SessionService } from './session.service.js';
import { type AccessTokens, signMfaToken, verifyMfaToken } from './tokens.js';
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
// Never matches a real user; used to give unknown emails the same lockout queries
const UNKNOWN_USER_ID = '00000000-unknown-user';
const LOCKOUT_MINUTES = 15;
// How far back sign-ins count when deciding whether a device is new
const KNOWN_DEVICE_DAYS = 90;

const invalidCredentials = () => new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
const notVerified = () =>
    new ForbiddenError('Account not verified. Please verify your email address.', 'EMAIL_NOT_VERIFIED');
const userNotFound = () => new NotFoundError('User not found', 'USER_NOT_FOUND');

export class AuthService {
    constructor(
        private readonly db: PrismaClient,
        private readonly codes: VerificationCodeService,
        private readonly sessions: SessionService,
        private readonly recoveryCodes: RecoveryCodeService,
        private readonly passkeys: PasskeyService,
        private readonly accessTokens: AccessTokens,
        private readonly breachedPasswords: BreachedPasswordChecker
    ) {}

    // NIST SP 800-63B: refuse passwords known from data breaches
    private async assertNotBreached(password: string, field: string) {
        if (await this.breachedPasswords.isBreached(password)) {
            throw new ValidationError([
                { field, message: 'This password has appeared in a data breach. Please choose a different one.' },
            ]);
        }
    }

    // Failed sign-ins within the lockout window, counted since the last successful one
    private async recentFailures(userId: string): Promise<number> {
        const windowStart = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
        const lastSuccess = await this.db.loginHistory.findFirst({
            where: { userId, successful: true, loginTime: { gt: windowStart } },
            orderBy: { loginTime: 'desc' },
            select: { loginTime: true },
        });

        return this.db.loginHistory.count({
            where: { userId, successful: false, loginTime: { gt: lastSuccess?.loginTime ?? windowStart } },
        });
    }

    // Temporary lock after too many failed signins since the last successful one,
    // which per-IP rate limits can't catch when an attacker spreads requests
    // Returns the current failure count so callers don't have to query it again
    private async assertNotLocked(userId: string, method: 'password' | 'two_factor'): Promise<number> {
        const failures = await this.recentFailures(userId);
        if (failures >= MAX_FAILED_SIGNINS) {
            recordSignin(method, 'locked');
            throw new TooManyRequestsError(
                `Too many failed sign-in attempts. Please try again in ${LOCKOUT_MINUTES} minutes.`,
                'ACCOUNT_LOCKED'
            );
        }
        return failures;
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

    // Accepts a 6 digit authenticator code or an unused recovery code. Using a recovery
    // code is logged and reported, since it often means the authenticator was lost.
    private async checkSecondFactor(user: User, code: string, context?: RequestContext): Promise<boolean> {
        if (/^\d{6}$/.test(code)) return this.checkTOTP(user, code);
        if (!(await this.recoveryCodes.consume(user.id, code))) return false;

        const remaining = await this.recoveryCodes.remaining(user.id);
        await this.db.$transaction(async (tx) => {
            await recordSecurityEvent(tx, user.id, 'recovery_code.used', context, { remaining });
            await enqueue(
                tx,
                'email.security-notice',
                this.securityNotice(user, `A recovery code was used (${remaining} left)`, context)
            );
        });
        return true;
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

    // The failed attempt that reaches the limit locks the account; that is logged and the
    // owner is told, since it usually means someone is guessing their password
    // previousFailures comes from assertNotLocked, which avoids another round trip on this
    // path (its timing has to stay close to the unknown-email path)
    private async registerFailedSignin(user: User, context: RequestContext, previousFailures: number) {
        await this.recordLoginAttempt(user.id, context, false);
        if (previousFailures + 1 !== MAX_FAILED_SIGNINS) return;

        recordAccountLocked();

        await this.db.$transaction(async (tx) => {
            await recordSecurityEvent(tx, user.id, 'account.locked', context, { failedAttempts: MAX_FAILED_SIGNINS });
            await enqueue(
                tx,
                'email.security-notice',
                this.securityNotice(
                    user,
                    `Your account was locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_SIGNINS} failed sign-in attempts`,
                    context
                )
            );
        });
    }

    // Lets the owner know when a sign-in comes from a browser/OS combination the account
    // hasn't used recently. Compares families, so browser updates don't trigger it.
    private async alertIfNewDevice(user: User, context: RequestContext) {
        const since = new Date(Date.now() - KNOWN_DEVICE_DAYS * 24 * 60 * 60 * 1000);
        const known = await this.db.loginHistory.findMany({
            where: { userId: user.id, successful: true, loginTime: { gt: since } },
            select: { userAgent: true },
            distinct: ['userAgent'],
            take: 100,
        });
        // First sign-in: nothing to compare with
        if (known.length === 0) return;

        const device = describeUserAgent(context.userAgent);
        if (known.some((row) => describeUserAgent(row.userAgent).fingerprint === device.fingerprint)) return;

        await this.db.$transaction(async (tx) => {
            await recordSecurityEvent(tx, user.id, 'signin.new_device', context, { device: device.label });
            await enqueue(tx, 'email.security-notice', this.securityNotice(user, `New sign-in from ${device.label}`, context));
        });
    }

    // Every successful sign-in (password, 2FA, passkey) ends here
    private async completeSignin(user: User, context: RequestContext, method: 'password' | 'two_factor' | 'passkey') {
        recordSignin(method, 'success');
        await this.alertIfNewDevice(user, context);
        await this.recordLoginAttempt(user.id, context, true);
        return { user: toPublicUser(user), ...(await this.startSession(user, context)) };
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
            accessToken: await this.accessTokens.sign({ userId: user.id, role: user.role, sessionId }),
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
        await this.assertNotBreached(password, 'password');

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
            // Same work as for a real account (lockout lookup and a password hash check),
            // so response times don't reveal whether the email is registered
            await this.recentFailures(UNKNOWN_USER_ID);
            await verifyAgainstDummy(password);
            recordSignin('password', 'failure');
            throw invalidCredentials();
        }

        const failures = await this.assertNotLocked(user.id, 'password');

        if (!(await this.checkPassword(user, password))) {
            recordSignin('password', 'failure');
            await this.registerFailedSignin(user, context, failures);
            throw invalidCredentials();
        }

        if (!user.isVerified) throw notVerified();

        // Password is right but a second factor is needed: hand out a short-lived challenge token
        if (user.totpEnabled) {
            recordSignin('password', 'second_factor_required');
            return { requiresTwoFactor: true, mfaToken: signMfaToken(user.id) };
        }

        return { requiresTwoFactor: false, ...(await this.completeSignin(user, context, 'password')) };
    }

    async logout(sessionId: string): Promise<void> {
        await this.sessions.revoke(sessionId);
    }

    async logoutAll(userId: string, context?: RequestContext): Promise<number> {
        const count = await this.sessions.revokeAll(userId);
        await recordSecurityEvent(this.db, userId, 'sessions.revoked_all', context, { count });
        return count;
    }

    async listSessions(userId: string, currentSessionId: string) {
        const sessions = await this.sessions.listActive(userId);
        return sessions.map((session) => ({ ...session, current: session.id === currentSessionId }));
    }

    async revokeSession(userId: string, sessionId: string, context?: RequestContext): Promise<void> {
        if (!(await this.sessions.revoke(sessionId, userId))) {
            throw new NotFoundError('Session not found', 'SESSION_NOT_FOUND');
        }
        await recordSecurityEvent(this.db, userId, 'session.revoked', context, { sessionId });
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
    async refresh(refreshToken: string, context?: RequestContext): Promise<{ accessToken: string; refreshToken: string }> {
        // A session that belongs to an OpenID Connect client can only be refreshed by that
        // client, at /oauth/token. Checked before rotating so the token isn't burned.
        if (await this.sessions.belongsToClient(refreshToken)) {
            throw new UnauthorizedError('Invalid or expired refresh token', 'INVALID_TOKEN');
        }
        const { session, refreshToken: nextRefreshToken } = await this.sessions.rotate(refreshToken, context);
        return {
            accessToken: await this.accessTokens.sign({ userId: session.userId, role: session.user.role, sessionId: session.id }),
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

        const verifiedUser = await this.db.$transaction(async (tx) => {
            await recordSecurityEvent(tx, user.id, 'email.verified');
            return tx.user.update({ where: { id: user.id }, data: { isVerified: true } });
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

        // Before consuming the code, so a refused password doesn't burn it
        await this.assertNotBreached(newPassword, 'newPassword');

        if (!user || !(await this.codes.consume(user.id, 'PASSWORD_RESET', code))) {
            throw new BadRequestError('Invalid or expired reset code', 'INVALID_CODE');
        }

        const passwordHash = await hashPassword(newPassword);
        await this.db.$transaction(async (tx) => {
            await tx.user.update({ where: { id: user.id }, data: { password: passwordHash } });
            await recordSecurityEvent(tx, user.id, 'password.reset', context);
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
        await this.assertNotBreached(newPassword, 'newPassword');

        const passwordHash = await hashPassword(newPassword);
        await this.db.$transaction(async (tx) => {
            await tx.user.update({ where: { id: userId }, data: { password: passwordHash } });
            await recordSecurityEvent(tx, userId, 'password.changed', context);
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
            await recordSecurityEvent(tx, userId, 'two_factor.enabled', context);
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
        if (!(await this.checkSecondFactor(user, code, context))) {
            throw new BadRequestError('Invalid two-factor code', 'INVALID_TWO_FACTOR_CODE');
        }

        const recoveryCodes = await this.recoveryCodes.regenerate(userId);
        await this.db.$transaction(async (tx) => {
            await recordSecurityEvent(tx, userId, 'recovery_codes.regenerated', context);
            await enqueue(tx, 'email.security-notice', this.securityNotice(user, 'New 2FA recovery codes were generated', context));
        });
        return { recoveryCodes };
    }

    // Second step of a 2FA signin: the challenge token from signin plus a TOTP code.
    // Wrong codes count towards the account lockout.
    async signin2FA({ mfaToken, code }: Signin2FAInput, context: RequestContext) {
        const user = await this.db.user.findUnique({ where: { id: verifyMfaToken(mfaToken) } });
        if (!user?.totpEnabled) {
            throw new UnauthorizedError('Two-factor session expired, please sign in again', 'INVALID_MFA_TOKEN');
        }

        const failures = await this.assertNotLocked(user.id, 'two_factor');

        if (!(await this.checkSecondFactor(user, code, context))) {
            recordSignin('two_factor', 'failure');
            await this.registerFailedSignin(user, context, failures);
            throw new UnauthorizedError('Invalid two-factor code', 'INVALID_TWO_FACTOR_CODE');
        }

        return this.completeSignin(user, context, 'two_factor');
    }

    async disable2FA(userId: string, code: string, context?: RequestContext): Promise<void> {
        const user = await this.findUserById(userId);
        if (!user.totpEnabled || !user.totpSecret) {
            throw new BadRequestError('2FA is not enabled for this account', 'TWO_FACTOR_NOT_ENABLED');
        }
        if (!(await this.checkSecondFactor(user, code, context))) {
            throw new BadRequestError('Invalid two-factor code', 'INVALID_TWO_FACTOR_CODE');
        }

        await this.db.$transaction(async (tx) => {
            await recordSecurityEvent(tx, userId, 'two_factor.disabled', context);
            await tx.user.update({
                where: { id: userId },
                data: { totpSecret: null, totpEnabled: false, totpLastUsedStep: null },
            });
            await tx.recoveryCode.deleteMany({ where: { userId } });
            await enqueue(tx, 'email.security-notice', this.securityNotice(user, 'Two-factor authentication was turned off', context));
        });
    }

    async passkeyRegistrationOptions(userId: string) {
        return this.passkeys.registrationOptions(await this.findUserById(userId));
    }

    async registerPasskey(userId: string, { response, name }: RegisterPasskeyInput, context?: RequestContext): Promise<PublicPasskey> {
        const user = await this.findUserById(userId);
        const passkey = await this.passkeys.register(userId, response as Parameters<PasskeyService['register']>[1], name);
        await this.db.$transaction(async (tx) => {
            await recordSecurityEvent(tx, userId, 'passkey.added', context, { name });
            await enqueue(tx, 'email.security-notice', this.securityNotice(user, `A passkey named "${name}" was added`, context));
        });
        return passkey;
    }

    async passkeySigninOptions() {
        return this.passkeys.authenticationOptions();
    }

    // Passwordless sign-in. A passkey with user verification is already two factors
    // (the device and its biometrics/PIN), so no TOTP code is asked for. The password
    // lockout doesn't apply either: it protects guessable secrets, and it would let an
    // attacker lock a user out of their passkey too.
    async signinWithPasskey({ response }: PasskeySigninInput, context: RequestContext) {
        let user: User;
        try {
            user = await this.passkeys.authenticate(response as Parameters<PasskeyService['authenticate']>[0]);
        } catch (error) {
            recordSignin('passkey', 'failure');
            throw error;
        }
        if (!user.isVerified) throw notVerified();

        return this.completeSignin(user, context, 'passkey');
    }

    async listPasskeys(userId: string): Promise<PublicPasskey[]> {
        return this.passkeys.list(userId);
    }

    async renamePasskey(userId: string, passkeyId: string, name: string): Promise<PublicPasskey> {
        return this.passkeys.rename(userId, passkeyId, name);
    }

    async removePasskey(userId: string, passkeyId: string, context?: RequestContext): Promise<void> {
        const user = await this.findUserById(userId);
        await this.passkeys.remove(userId, passkeyId);
        await this.db.$transaction(async (tx) => {
            await recordSecurityEvent(tx, userId, 'passkey.removed', context);
            await enqueue(tx, 'email.security-notice', this.securityNotice(user, 'A passkey was removed', context));
        });
    }
}
