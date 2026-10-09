import type { CodePurpose, PrismaClient } from '../../generated/prisma/client.js';
import { TooManyRequestsError } from '../../shared/errors/app-error.js';
import { deriveKey, hmacSha256, safeEqual } from '../../shared/utils/crypto.js';
import { generateOTP } from '../../shared/utils/otp.js';

export const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

const codeKey = deriveKey('verification-code');

// Codes are short, so a plain hash could be brute forced from a DB dump. A keyed
// HMAC can't be reversed without the server key.
const hashCode = (userId: string, code: string) => hmacSha256(codeKey, `${userId}:${code}`);

// Issues and checks single-use email codes (verification, password reset)
export class VerificationCodeService {
    constructor(private readonly db: PrismaClient) {}

    // Creates a fresh code, replacing any previous one. Returns the plain code to email.
    async issue(userId: string, purpose: CodePurpose): Promise<string> {
        const existing = await this.db.verificationCode.findUnique({
            where: { userId_purpose: { userId, purpose } },
        });
        if (existing && Date.now() - existing.createdAt.getTime() < RESEND_COOLDOWN_MS) {
            throw new TooManyRequestsError('Please wait a minute before requesting another code', 'CODE_COOLDOWN');
        }

        const code = generateOTP();
        const data = {
            codeHash: hashCode(userId, code),
            attempts: 0,
            expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
            createdAt: new Date(),
        };

        await this.db.verificationCode.upsert({
            where: { userId_purpose: { userId, purpose } },
            create: { userId, purpose, ...data },
            update: data,
        });

        return code;
    }

    // True if the code is valid; the code is then consumed. Every check uses up one
    // of MAX_ATTEMPTS, after which the code is discarded.
    async consume(userId: string, purpose: CodePurpose, code: string): Promise<boolean> {
        const record = await this.db.verificationCode.findUnique({
            where: { userId_purpose: { userId, purpose } },
        });
        if (!record) return false;

        if (record.expiresAt < new Date()) {
            await this.db.verificationCode.deleteMany({ where: { id: record.id } });
            return false;
        }

        // Claim an attempt before comparing, so parallel guesses can't get more than MAX_ATTEMPTS checks
        const { count: claimed } = await this.db.verificationCode.updateMany({
            where: { id: record.id, attempts: { lt: MAX_ATTEMPTS } },
            data: { attempts: { increment: 1 } },
        });
        if (claimed === 0) {
            await this.db.verificationCode.deleteMany({ where: { id: record.id } });
            return false;
        }

        if (!safeEqual(record.codeHash, hashCode(userId, code))) return false;

        // Only one of two concurrent uses of the same code can delete it
        const { count } = await this.db.verificationCode.deleteMany({ where: { id: record.id } });
        return count === 1;
    }
}
