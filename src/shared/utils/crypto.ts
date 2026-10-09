import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

const masterKey = Buffer.from(env.ENCRYPTION_KEY, 'base64');

// Derives an independent 32 byte key per purpose, so one secret can safely serve several uses
export const deriveKey = (purpose: string): Buffer =>
    Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), purpose, 32));

export const hmacSha256 = (key: Buffer, value: string): string =>
    createHmac('sha256', key).update(value).digest('hex');

// Constant-time comparison of two strings
export const safeEqual = (a: string, b: string): boolean => {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

// URL-safe random token
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

// Fine for high-entropy random tokens; use hmacSha256 for low-entropy values like codes
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

