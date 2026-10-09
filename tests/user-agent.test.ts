import { describe, expect, it } from 'vitest';
import { detectDevice } from '../src/shared/utils/user-agent.js';

describe('detectDevice', () => {
    it.each([
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 'Mobile'],
        ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 'Mobile'],
        ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 'Tablet'],
        ['Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 'Tablet'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 'Desktop'],
        ['curl/8.7.1', 'Desktop'],
    ])('%s -> %s', (userAgent, expected) => {
        expect(detectDevice(userAgent)).toBe(expected);
    });

    it('returns Unknown without a user agent', () => {
        expect(detectDevice(null)).toBe('Unknown');
    });
});
