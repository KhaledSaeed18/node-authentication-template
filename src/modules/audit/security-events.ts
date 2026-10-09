import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { DbClient } from '../../lib/prisma.js';
import { describeUserAgent } from '../../shared/utils/user-agent.js';
import { type Page, type PaginationQuery, toPage } from '../../shared/validation/pagination.js';

export const SECURITY_EVENT_TYPES = [
    'email.verified',
    'email.changed',
    'password.changed',
    'password.reset',
    'two_factor.enabled',
    'two_factor.disabled',
    'recovery_codes.regenerated',
    'recovery_code.used',
    'passkey.added',
    'passkey.removed',
    'session.revoked',
    'sessions.revoked_all',
    'account.locked',
    'signin.new_device',
    'refresh_token.reuse_detected',
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export interface EventContext {
    ipAddress: string | null;
    userAgent: string | null;
}

// Pass a transaction client to record the event atomically with the change it describes
export const recordSecurityEvent = async (
    db: DbClient,
    userId: string,
    type: SecurityEventType,
    context?: EventContext,
    metadata?: Record<string, string | number | boolean>
): Promise<void> => {
    await db.securityEvent.create({
        data: {
            userId,
            type,
            ipAddress: context?.ipAddress ?? null,
            userAgent: context?.userAgent ?? null,
            metadata: metadata as Prisma.InputJsonValue | undefined,
        },
    });
};

export interface SecurityEventView {
    id: string;
    type: string;
    ipAddress: string | null;
    device: string;
    metadata: unknown;
    createdAt: Date;
}

export class SecurityEventsService {
    constructor(private readonly db: PrismaClient) {}

    // Newest first, cursor paginated
    async list(userId: string, { limit, cursor }: PaginationQuery): Promise<Page<SecurityEventView>> {
        const rows = await this.db.securityEvent.findMany({
            where: { userId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        });

        return toPage(
            rows.map((row) => ({
                id: row.id,
                type: row.type,
                ipAddress: row.ipAddress,
                device: describeUserAgent(row.userAgent).label,
                metadata: row.metadata,
                createdAt: row.createdAt,
            })),
            limit
        );
    }
}
