import type { PrismaClient } from '../../generated/prisma/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CleanupResult {
    sessions: number;
    verificationCodes: number;
    loginHistory: number;
    outboxMessages: number;
    webauthnChallenges: number;
    signingKeys: number;
}

// Delivered jobs are only kept briefly; failed ones longer, so they can be inspected
const DONE_JOB_RETENTION_DAYS = 7;
const FAILED_JOB_RETENTION_DAYS = 30;

// Deletes data that is no longer useful: ended sessions, expired codes, login
// history past the retention period and old outbox jobs. Safe to run as often as you like.
export const cleanupExpiredData = async (
    db: PrismaClient,
    {
        loginHistoryRetentionDays,
        retiredSigningKeyRetentionMs,
    }: { loginHistoryRetentionDays: number; retiredSigningKeyRetentionMs: number },
    now = new Date()
): Promise<CleanupResult> => {
    const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

    const [sessions, verificationCodes, loginHistory, outboxMessages, webauthnChallenges, signingKeys] = await Promise.all([
        db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] } }),
        db.verificationCode.deleteMany({ where: { expiresAt: { lt: now } } }),
        db.loginHistory.deleteMany({
            where: { loginTime: { lt: daysAgo(loginHistoryRetentionDays) } },
        }),
        db.outboxMessage.deleteMany({
            where: {
                OR: [
                    { status: 'DONE', processedAt: { lt: daysAgo(DONE_JOB_RETENTION_DAYS) } },
                    { status: 'FAILED', createdAt: { lt: daysAgo(FAILED_JOB_RETENTION_DAYS) } },
                ],
            },
        }),
        db.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: now } } }),
        // Retired keys no longer published (every token they signed has expired)
        db.signingKey.deleteMany({ where: { retiredAt: { lt: new Date(now.getTime() - retiredSigningKeyRetentionMs) } } }),
    ]);

    return {
        sessions: sessions.count,
        verificationCodes: verificationCodes.count,
        loginHistory: loginHistory.count,
        outboxMessages: outboxMessages.count,
        webauthnChallenges: webauthnChallenges.count,
        signingKeys: signingKeys.count,
    };
};
