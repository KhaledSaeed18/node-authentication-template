import { describe, expect, it } from 'vitest';
import { describeUserAgent, detectDevice } from '../src/shared/utils/user-agent.js';

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

describe('describeUserAgent', () => {
    it.each([
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', 'Chrome on macOS'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0', 'Edge on Windows'],
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'Safari on iOS'],
        ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
        ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', 'Chrome on Android'],
        ['curl/8.7.1', 'an unknown device'],
    ])('%s -> %s', (userAgent, label) => {
        expect(describeUserAgent(userAgent).label).toBe(label);
    });

    it('gives the same fingerprint across browser updates', () => {
        const older = describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0 Safari/537.36');
        const newer = describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36');
        expect(newer.fingerprint).toBe(older.fingerprint);
    });
});

