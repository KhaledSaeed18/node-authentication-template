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
