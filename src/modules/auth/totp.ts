import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { decrypt, deriveKey, encrypt, isEncrypted } from '../../shared/utils/crypto.js';

const secretKey = deriveKey('totp-secret');

// New TOTP secret plus the otpauth:// URI authenticator apps understand
export const generateTOTPSecret = (email: string): { secret: string; otpauthUrl: string } => {
    const secret = generateSecret();
    return { secret, otpauthUrl: generateURI({ issuer: env.APP_NAME, label: email, secret }) };
};

export const generateQRCode = async (otpauthUrl: string): Promise<string> => {
    try {
        return await QRCode.toDataURL(otpauthUrl);
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to generate QR code: ${errorMessage}`, { cause: error });
    }
};

// Secrets are stored encrypted; values from older versions may still be plaintext
export const sealTOTPSecret = (secret: string): string => encrypt(secretKey, secret);
export const openTOTPSecret = (stored: string): string => (isEncrypted(stored) ? decrypt(secretKey, stored) : stored);

// Returns the matched time step, or null. Codes from lastUsedStep or earlier are
// rejected, so a code can't be used twice. Allows one 30s step of clock drift.
export const verifyTOTP = async (token: string, secret: string, lastUsedStep?: number | null): Promise<number | null> => {
    try {
        const result = await verify({
            secret,
            token,
            epochTolerance: 30,
            ...(lastUsedStep != null && { afterTimeStep: lastUsedStep }),
        });
        // verify() is typed for HOTP and TOTP; only TOTP results carry a time step
        return result.valid && 'timeStep' in result ? result.timeStep : null;
    } catch (error) {
        logger.warn({ err: error }, 'TOTP verification failed');
        return null;
    }
};
