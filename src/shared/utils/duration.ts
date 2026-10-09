const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 } as const;

// Converts durations like "15m" or "7d" to milliseconds
export const durationToMs = (duration: string): number => {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) throw new Error(`Invalid duration: ${duration}`);
    return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
};
