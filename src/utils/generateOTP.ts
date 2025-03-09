import crypto from 'crypto';

// Generates secure 6-digit OTP
export const generateOTP = (): string => {
    const max = 1000000;

    let randomNumber;
    const rangeSize = Math.pow(2, 32);
    const blockCount = Math.floor(rangeSize / max);
    const limit = blockCount * max;

    do {
        const randomBytes = crypto.randomBytes(4);
        randomNumber = randomBytes.readUInt32BE(0);
    } while (randomNumber >= limit);

    const sixDigits = randomNumber % max;

    return sixDigits.toString().padStart(6, '0');
};