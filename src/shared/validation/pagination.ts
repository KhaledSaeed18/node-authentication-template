import { z } from 'zod';

// ?limit=20&cursor=<id of the last item from the previous page>
export const paginationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().trim().min(1).max(64).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
    items: T[];
    nextCursor: string | null;
}

// Expects limit + 1 rows: the extra one only tells whether another page exists
export const toPage = <T extends { id: string }>(rows: T[], limit: number): Page<T> => {
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
};
