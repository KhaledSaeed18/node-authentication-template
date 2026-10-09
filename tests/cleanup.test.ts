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
    it('removes only ended sessions, expired codes, old login history and old jobs', async () => {
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

        await prisma.outboxMessage.createMany({
            data: [
                { type: 'email.verification', payload: {}, status: 'DONE', processedAt: ago(8 * DAY) },
                { type: 'email.verification', payload: {}, status: 'DONE', processedAt: ago(1 * DAY) },
                { type: 'email.verification', payload: {}, status: 'FAILED', createdAt: ago(31 * DAY) },
                { type: 'email.verification', payload: {}, status: 'FAILED', createdAt: ago(2 * DAY) },
                { type: 'email.verification', payload: {}, status: 'PENDING', createdAt: ago(60 * DAY) },
            ],
        });

        await prisma.webAuthnChallenge.createMany({
            data: [
                { challenge: 'expired', ceremony: 'AUTHENTICATION', expiresAt: ago(1000) },
                { challenge: 'live', ceremony: 'AUTHENTICATION', expiresAt: inFuture(60_000) },
            ],
        });

        await prisma.signingKey.createMany({
            data: [
                { id: 'active', publicJwk: {}, privateKey: 'x' },
                { id: 'recently-retired', publicJwk: {}, privateKey: 'x', retiredAt: ago(60_000) },
                { id: 'long-retired', publicJwk: {}, privateKey: 'x', retiredAt: ago(DAY) },
            ],
        });

        await prisma.securityEvent.createMany({
            data: [
                { userId, type: 'password.changed', createdAt: ago(400 * DAY) },
                { userId, type: 'password.changed', createdAt: ago(30 * DAY) },
            ],
        });

        const result = await cleanupExpiredData(prisma, { loginHistoryRetentionDays: 90, retiredSigningKeyRetentionMs: 20 * 60 * 1000 });

        expect(result).toEqual({
            sessions: 2,
            verificationCodes: 1,
            loginHistory: 1,
            outboxMessages: 2,
            webauthnChallenges: 1,
            signingKeys: 1,
            securityEvents: 1,
        });
        expect((await prisma.signingKey.findMany()).map((k) => k.id).sort()).toEqual(['active', 'recently-retired']);
        // Pending jobs are never removed, however old
        expect(await prisma.outboxMessage.count({ where: { status: 'PENDING' } })).toBe(1);
        expect((await prisma.session.findMany()).map((s) => s.tokenHash)).toEqual(['active']);
        expect(await prisma.verificationCode.count()).toBe(1);
        expect(await prisma.loginHistory.count()).toBe(1);
    });
});
