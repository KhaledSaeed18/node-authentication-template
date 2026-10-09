import { hash, parseOptions, verify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

// OWASP recommended Argon2id parameters (the library defaults to Argon2id)
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const isBcryptHash = (hashed: string) => /^\$2[aby]\$/.test(hashed);

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2_OPTIONS);

// Checks a password against an Argon2id hash, or a bcrypt hash from older versions.
// needsRehash tells the caller to store a fresh hash with the current settings.
export const verifyPassword = async (
    hashed: string,
    password: string
): Promise<{ valid: boolean; needsRehash: boolean }> => {
    if (isBcryptHash(hashed)) {
        const valid = await bcrypt.compare(password, hashed);
        return { valid, needsRehash: valid };
    }

    const valid = await verify(hashed, password);
    if (!valid) return { valid, needsRehash: false };

    const params = parseOptions(hashed);
    const outdated =
        params.memoryCost !== ARGON2_OPTIONS.memoryCost ||
        params.timeCost !== ARGON2_OPTIONS.timeCost ||
        params.parallelism !== ARGON2_OPTIONS.parallelism;
    return { valid, needsRehash: outdated };
};
