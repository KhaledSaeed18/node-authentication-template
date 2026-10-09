import { createHash } from 'node:crypto';
import { logger } from '../../lib/logger.js';

export interface BreachedPasswordChecker {
    isBreached(password: string): Promise<boolean>;
}

// Have I Been Pwned's Pwned Passwords range API, used with k-anonymity: only the first
// 5 characters of the password's SHA-1 are sent, the matching suffixes come back and
// are compared locally, so the password (and its full hash) never leave the server.
// Padding hides how many suffixes share the prefix.
export class PwnedPasswordsChecker implements BreachedPasswordChecker {
    constructor(
        private readonly timeoutMs = 2000,
        private readonly fetchFn: typeof fetch = fetch
    ) {}

    async isBreached(password: string): Promise<boolean> {
        const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
        const prefix = hash.slice(0, 5);
        const suffix = hash.slice(5);

        try {
            const response = await this.fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`, {
                headers: { 'Add-Padding': 'true', 'User-Agent': 'node-authentication-template' },
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            if (!response.ok) throw new Error(`Pwned Passwords answered ${response.status}`);

            return (await response.text()).split('\n').some((line) => {
                const [candidate, count] = line.trim().split(':');
                // Padding entries have a count of 0
                return candidate === suffix && Number(count) > 0;
            });
        } catch (error) {
            // Fail open: an outage of the API must not block signups and password changes
            logger.warn({ err: error }, 'Breached password check unavailable, skipping it');
            return false;
        }
    }
}

export const skipBreachCheck: BreachedPasswordChecker = { isBreached: async () => false };
