import type { PrismaClient } from '../../generated/prisma/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CleanupResult {
    sessions: number;
    verificationCodes: number;
    loginHistory: number;
}

// Deletes data that is no longer useful: ended sessions, expired codes and login
// history past the retention period. Safe to run as often as you like.
export const cleanupExpiredData = async (
    db: PrismaClient,
    { loginHistoryRetentionDays }: { loginHistoryRetentionDays: number },
    now = new Date()
): Promise<CleanupResult> => {
    const [sessions, verificationCodes, loginHistory] = await Promise.all([
        db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] } }),
        db.verificationCode.deleteMany({ where: { expiresAt: { lt: now } } }),
        db.loginHistory.deleteMany({
            where: { loginTime: { lt: new Date(now.getTime() - loginHistoryRetentionDays * DAY_MS) } },
        }),
    ]);

    return { sessions: sessions.count, verificationCodes: verificationCodes.count, loginHistory: loginHistory.count };
};
