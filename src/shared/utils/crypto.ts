import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
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

const ENCRYPTION_PREFIX = 'v1';

// AES-256-GCM, output: "v1:<iv>:<auth tag>:<ciphertext>" (base64url parts)
export const encrypt = (key: Buffer, plaintext: string): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [ENCRYPTION_PREFIX, iv, cipher.getAuthTag(), ciphertext].map((part) =>
        typeof part === 'string' ? part : part.toString('base64url')
    ).join(':');
};

export const isEncrypted = (value: string): boolean => value.startsWith(`${ENCRYPTION_PREFIX}:`);

export const decrypt = (key: Buffer, payload: string): string => {
    const [prefix, iv, tag, ciphertext] = payload.split(':');
    if (prefix !== ENCRYPTION_PREFIX || !iv || !tag || !ciphertext) throw new Error('Malformed encrypted value');

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
};

