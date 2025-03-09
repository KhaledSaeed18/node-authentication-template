import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

interface Payload {
    userId: string;
    role: Role;
}

// Generate access token
export const generateAccessToken = (userId: string, role: Role): string => {
    const payload: Payload = { userId, role };
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET as string, {
        expiresIn: '20m',
    });

    return accessToken;
};

// Generate refresh token
export const generateRefreshToken = (userId: string, role: Role): string => {
    const payload: Payload = { userId, role };
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET as string, {
        expiresIn: '7d',
    });

    return refreshToken;
};