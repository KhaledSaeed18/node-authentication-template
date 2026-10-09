import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { logger } from '../../lib/logger.js';

const ISSUER = 'App name';

// Generate a secret key for TOTP
export const generateTOTPSecret = (email: string): { secret: string; otpauth_url: string } => {
    const secret = generateSecret();

    return {
        secret,
        otpauth_url: generateURI({ issuer: ISSUER, label: email, secret })
    };
};

// Generate QR code data URL from otpauth URL
export const generateQRCode = async (otpauthUrl: string): Promise<string> => {
    try {
        const dataUrl = await QRCode.toDataURL(otpauthUrl);
        return dataUrl;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to generate QR code: ${errorMessage}`, { cause: error });
    }
};

// Verify TOTP token, accepting one 30s step of clock drift either way
export const verifyTOTP = async (token: string, secret: string): Promise<boolean> => {
    try {
        const result = await verify({ secret, token, epochTolerance: 30 });
        return result.valid;
    } catch (error) {
        logger.warn({ err: error }, 'TOTP verification failed');
        return false;
    }
};
