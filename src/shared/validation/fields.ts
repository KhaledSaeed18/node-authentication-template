import { z } from 'zod';

// Letters from any script plus the punctuation real names use (O'Brien, Anne-Marie, J. R.)
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}' .-]*$/u;

export const personName = (label: string) =>
    z
        .string()
        .trim()
        .min(1, `${label} is required`)
        .max(50, `${label} cannot exceed 50 characters`)
        .regex(NAME_PATTERN, `${label} can only contain letters, spaces, apostrophes, hyphens and periods`);
