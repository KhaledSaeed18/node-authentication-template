import { z } from 'zod';
import { personName } from '../../shared/validation/fields.js';

export const updateProfileSchema = z
    .object({
        firstName: personName('First name').optional(),
        lastName: personName('Last name').optional(),
    })
    .refine((data) => data.firstName !== undefined || data.lastName !== undefined, {
        message: 'Provide at least one field to update',
    });

export const userIdParamsSchema = z.object({
    userId: z.string().trim().min(1).max(64),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
