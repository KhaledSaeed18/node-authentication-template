import type { User } from '../../generated/prisma/client.js';

// The user fields that are safe to send to clients
export type PublicUser = Pick<
    User,
    'id' | 'firstName' | 'lastName' | 'email' | 'role' | 'isVerified' | 'totpEnabled' | 'createdAt'
>;

export const toPublicUser = (user: User): PublicUser => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    isVerified: user.isVerified,
    totpEnabled: user.totpEnabled,
    createdAt: user.createdAt,
});

export const publicUserSelect = {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    role: true,
    isVerified: true,
    totpEnabled: true,
    createdAt: true,
} as const;
