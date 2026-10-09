import { env } from '../../config/env.js';
import type { PrismaClient, Session, User } from '../../generated/prisma/client.js';
import { logger } from '../../lib/logger.js';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import { randomToken, safeEqual, sha256 } from '../../shared/utils/crypto.js';
import { durationToMs } from '../../shared/utils/duration.js';
import type { RequestContext } from './auth.service.js';
import { recordSecurityEvent } from '../audit/security-events.js';
import { enqueue } from '../outbox/outbox.js';
import './auth.jobs.js';

// Two tabs refreshing at the same time is not an attack; within this window a
// just-rotated token is rejected without revoking the session
const ROTATION_GRACE_MS = 10 * 1000;

const refreshTtlMs = () => durationToMs(env.REFRESH_TOKEN_TTL);

// Refresh tokens look like "<sessionId>.<secret>"; only a hash of the secret is stored
const buildToken = (sessionId: string, secret: string) => `${sessionId}.${secret}`;

const parseToken = (token: string) => {
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    return { sessionId: token.slice(0, dot), secret: token.slice(dot + 1) };
};

const invalidToken = () => new UnauthorizedError('Invalid or expired refresh token', 'INVALID_TOKEN');

export type PublicSession = Pick<Session, 'id' | 'ipAddress' | 'userAgent' | 'createdAt' | 'lastUsedAt' | 'expiresAt'>;

export class SessionService {
    constructor(private readonly db: PrismaClient) {}

    async create(userId: string, context: RequestContext): Promise<{ sessionId: string; refreshToken: string }> {
        // Opportunistic cleanup of this user's dead sessions
        await this.db.session.deleteMany({
            where: { userId, OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }] },
        });

        const secret = randomToken();
        const session = await this.db.session.create({
            data: {
                userId,
                tokenHash: sha256(secret),
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
                expiresAt: new Date(Date.now() + refreshTtlMs()),
            },
        });

        return { sessionId: session.id, refreshToken: buildToken(session.id, secret) };
    }

    // Exchanges a refresh token for a new one. Presenting an already rotated token
    // means it leaked, so the whole session is revoked.
    async rotate(refreshToken: string, context?: RequestContext): Promise<{ session: Session & { user: User }; refreshToken: string }> {
        const parsed = parseToken(refreshToken);
        if (!parsed) throw invalidToken();

        const session = await this.db.session.findUnique({ where: { id: parsed.sessionId }, include: { user: true } });
        if (!session || session.revokedAt || session.expiresAt < new Date()) throw invalidToken();

        const presentedHash = sha256(parsed.secret);

        if (safeEqual(presentedHash, session.tokenHash)) {
            const secret = randomToken();
            const now = new Date();

            // Only succeeds if nobody rotated this token in the meantime
            const { count } = await this.db.session.updateMany({
                where: { id: session.id, tokenHash: presentedHash, revokedAt: null },
                data: {
                    tokenHash: sha256(secret),
                    previousTokenHash: presentedHash,
                    rotatedAt: now,
                    lastUsedAt: now,
                    expiresAt: new Date(now.getTime() + refreshTtlMs()),
                },
            });
            if (count === 1) return { session, refreshToken: buildToken(session.id, secret) };

            throw new UnauthorizedError('Refresh token was already used', 'TOKEN_ROTATED');
        }

        if (session.previousTokenHash && safeEqual(presentedHash, session.previousTokenHash)) {
            if (session.rotatedAt && Date.now() - session.rotatedAt.getTime() < ROTATION_GRACE_MS) {
                throw new UnauthorizedError('Refresh token was already used', 'TOKEN_ROTATED');
            }

            await this.revoke(session.id);
            logger.warn({ sessionId: session.id, userId: session.userId }, 'Refresh token reuse detected, session revoked');
            await this.db.$transaction(async (tx) => {
                await recordSecurityEvent(tx, session.userId, 'refresh_token.reuse_detected', context, { sessionId: session.id });
                await enqueue(tx, 'email.security-notice', {
                    userId: session.userId,
                    event: 'A stolen session token may have been used; that session was signed out',
                    occurredAt: new Date().toISOString(),
                    ipAddress: context?.ipAddress ?? null,
                });
            });
            throw new UnauthorizedError('Refresh token reuse detected, please sign in again', 'TOKEN_REUSED');
        }

        throw invalidToken();
    }

    async isActive(sessionId: string): Promise<boolean> {
        const session = await this.db.session.findUnique({
            where: { id: sessionId },
            select: { revokedAt: true, expiresAt: true },
        });
        return !!session && !session.revokedAt && session.expiresAt > new Date();
    }

    async revoke(sessionId: string, userId?: string): Promise<boolean> {
        const { count } = await this.db.session.updateMany({
            where: { id: sessionId, revokedAt: null, ...(userId && { userId }) },
            data: { revokedAt: new Date() },
        });
        return count === 1;
    }

    async revokeAll(userId: string, exceptSessionId?: string): Promise<number> {
        const { count } = await this.db.session.updateMany({
            where: { userId, revokedAt: null, ...(exceptSessionId && { id: { not: exceptSessionId } }) },
            data: { revokedAt: new Date() },
        });
        return count;
    }

    async listActive(userId: string): Promise<PublicSession[]> {
        return this.db.session.findMany({
            where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
            orderBy: { lastUsedAt: 'desc' },
            select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
        });
    }
}
