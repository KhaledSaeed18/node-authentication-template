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

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
