import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { cleanupExpiredData } from '../src/modules/maintenance/cleanup.js';
import { resetDatabase } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);
const inFuture = (ms: number) => new Date(Date.now() + ms);

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('cleanupExpiredData', () => {
    it('removes only ended sessions, expired codes and old login history', async () => {
        const { id: userId } = await prisma.user.create({
            data: { firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.io', password: 'x' },
        });

        await prisma.session.createMany({
            data: [
                { userId, tokenHash: 'active', expiresAt: inFuture(DAY) },
                { userId, tokenHash: 'expired', expiresAt: ago(1000) },
                { userId, tokenHash: 'revoked', expiresAt: inFuture(DAY), revokedAt: ago(1000) },
            ],
        });
        await prisma.verificationCode.createMany({
            data: [
                { userId, purpose: 'EMAIL_VERIFICATION', codeHash: 'x', expiresAt: ago(1000) },
                { userId, purpose: 'PASSWORD_RESET', codeHash: 'y', expiresAt: inFuture(DAY) },
            ],
        });
        await prisma.loginHistory.createMany({
            data: [
                { userId, loginTime: ago(100 * DAY) },
                { userId, loginTime: ago(10 * DAY) },
            ],
        });

        const result = await cleanupExpiredData(prisma, { loginHistoryRetentionDays: 90 });

        expect(result).toEqual({ sessions: 2, verificationCodes: 1, loginHistory: 1 });
        expect((await prisma.session.findMany()).map((s) => s.tokenHash)).toEqual(['active']);
        expect(await prisma.verificationCode.count()).toBe(1);
        expect(await prisma.loginHistory.count()).toBe(1);
    });
});
