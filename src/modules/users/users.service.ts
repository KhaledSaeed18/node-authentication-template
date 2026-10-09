import type { PrismaClient } from '../../generated/prisma/client.js';
import { NotFoundError } from '../../shared/errors/app-error.js';
import { type Page, type PaginationQuery, toPage } from '../../shared/validation/pagination.js';
import { type PublicUser, publicUserSelect } from './users.mapper.js';
import type { UpdateProfileInput } from './users.schemas.js';

export class UsersService {
    constructor(private readonly db: PrismaClient) {}

    async getProfile(userId: string): Promise<PublicUser> {
        const user = await this.db.user.findUnique({ where: { id: userId }, select: publicUserSelect });
        if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
        return user;
    }

    async updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
        return this.db.user.update({ where: { id: userId }, data: input, select: publicUserSelect });
    }

    // Everything stored about the user (GDPR right of access), minus secrets: no
    // password hash, 2FA secret, token or code hashes
    async exportData(userId: string) {
        const user = await this.db.user.findUnique({
            where: { id: userId },
            select: {
                ...publicUserSelect,
                updatedAt: true,
                sessions: {
                    select: {
                        id: true,
                        ipAddress: true,
                        userAgent: true,
                        clientId: true,
                        createdAt: true,
                        lastUsedAt: true,
                        expiresAt: true,
                        revokedAt: true,
                    },
                    orderBy: { createdAt: 'desc' },
                },
                LoginHistory: {
                    select: { ipAddress: true, userAgent: true, device: true, loginTime: true, successful: true },
                    orderBy: { loginTime: 'desc' },
                },
                securityEvents: {
                    select: { type: true, ipAddress: true, userAgent: true, metadata: true, createdAt: true },
                    orderBy: { createdAt: 'desc' },
                },
                passkeys: { select: { name: true, deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true } },
                recoveryCodes: { select: { usedAt: true, createdAt: true } },
                oauthConsents: { select: { scopes: true, createdAt: true, client: { select: { name: true } } } },
            },
        });
        if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        const { LoginHistory: loginHistory, recoveryCodes, oauthConsents, ...rest } = user;
        return {
            exportedAt: new Date().toISOString(),
            ...rest,
            loginHistory,
            recoveryCodes: { total: recoveryCodes.length, unused: recoveryCodes.filter((code) => !code.usedAt).length },
            oauthConsents: oauthConsents.map(({ client, ...consent }) => ({ client: client.name, ...consent })),
        };
    }

    // Admin listing, newest accounts first
    async list({ limit, cursor }: PaginationQuery): Promise<Page<PublicUser>> {
        const rows = await this.db.user.findMany({
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(cursor && { cursor: { id: cursor }, skip: 1 }),
            select: publicUserSelect,
        });
        return toPage(rows, limit);
    }
}
