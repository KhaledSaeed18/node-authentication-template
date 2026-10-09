import { randomInt } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { deriveKey, hmacSha256 } from '../../shared/utils/crypto.js';

const CODE_COUNT = 10;
// No 0/o, 1/l/i to avoid misreading; 8 characters give ~40 bits per code
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const codeKey = deriveKey('recovery-code');

const normalize = (code: string) => code.toLowerCase().replace(/[\s-]/g, '');
const hashCode = (userId: string, code: string) => hmacSha256(codeKey, `${userId}:${normalize(code)}`);

const randomCode = () => {
    const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
};

export class RecoveryCodeService {
    constructor(private readonly db: PrismaClient) {}

    // Replaces all of the user's codes. The plain codes are only ever returned here.
    async regenerate(userId: string): Promise<string[]> {
        const codes = Array.from({ length: CODE_COUNT }, randomCode);

        await this.db.$transaction([
            this.db.recoveryCode.deleteMany({ where: { userId } }),
            this.db.recoveryCode.createMany({
                data: codes.map((code) => ({ userId, codeHash: hashCode(userId, code) })),
            }),
        ]);

        return codes;
    }

    // Marks the code as used; true only for an unused code of this user
    async consume(userId: string, code: string): Promise<boolean> {
        const { count } = await this.db.recoveryCode.updateMany({
            where: { userId, codeHash: hashCode(userId, code), usedAt: null },
            data: { usedAt: new Date() },
        });
        return count === 1;
    }

    async remaining(userId: string): Promise<number> {
        return this.db.recoveryCode.count({ where: { userId, usedAt: null } });
    }
}
