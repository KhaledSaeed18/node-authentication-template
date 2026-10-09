import jwt from 'jsonwebtoken';
import type { Role } from '../generated/prisma/enums.js';
import { env } from '../config/env.js';

interface Payload {
    userId: string;
    role: Role;
}

// Generate access token
export const generateAccessToken = (userId: string, role: Role): string => {
    const payload: Payload = { userId, role };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: '20m',
    });

    return accessToken;
};

// Generate refresh token
export const generateRefreshToken = (userId: string, role: Role): string => {
    const payload: Payload = { userId, role };
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
        expiresIn: '7d',
    });

    return refreshToken;
};