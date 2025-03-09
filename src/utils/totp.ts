import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

// Generate a secret key for TOTP
export const generateTOTPSecret = (email: string): { secret: string; otpauth_url: string } => {
    const secretConfig = speakeasy.generateSecret({
        name: `App name:${email}`,
        issuer: 'App name'
    });

    // Handle the case when base32 or otpauth_url might be undefined
    if (!secretConfig.base32 || !secretConfig.otpauth_url) {
        throw new Error('Failed to generate TOTP secret');
    }

    return {
        secret: secretConfig.base32,
        otpauth_url: secretConfig.otpauth_url
    };
};

// Generate QR code data URL from otpauth URL
export const generateQRCode = async (otpauthUrl: string): Promise<string> => {
    try {
        const dataUrl = await QRCode.toDataURL(otpauthUrl);
        return dataUrl;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to generate QR code: ${errorMessage}`);
    }
};

// Verify TOTP token
export const verifyTOTP = (token: string, secret: string): boolean => {
    try {
        return speakeasy.totp.verify({
            secret,
            encoding: 'base32',
            token,
            window: 1
        });
    } catch (error) {
        console.error('Error verifying TOTP token:', error);
        return false;
    }
};