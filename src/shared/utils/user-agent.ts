export type DeviceType = 'Mobile' | 'Tablet' | 'Desktop' | 'Unknown';

// Rough device type from a User-Agent string. Tablets are checked first because
// iPad UAs contain "Mobile" and Android tablets are Android without "Mobile".
export const detectDevice = (userAgent: string | null | undefined): DeviceType => {
    if (!userAgent) return 'Unknown';
    if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) {
        return 'Tablet';
    }
    if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) return 'Mobile';
    return 'Desktop';
};

// Order matters: Edge and Opera UAs also contain "Chrome", Chrome's contains "Safari"
const BROWSERS: [RegExp, string][] = [
    [/Edg(e|A|iOS)?\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser/, 'Samsung Internet'],
    [/Firefox|FxiOS/, 'Firefox'],
    [/Chrome|CriOS|Chromium/, 'Chrome'],
    [/Safari/, 'Safari'],
];

const OPERATING_SYSTEMS: [RegExp, string][] = [
    [/iPhone|iPad|iPod/, 'iOS'],
    [/Android/, 'Android'],
    [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
];

const firstMatch = (userAgent: string, table: [RegExp, string][]) =>
    table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Unknown';

export interface DeviceDescription {
    browser: string;
    os: string;
    // Browser and OS families only: stays the same across browser updates
    fingerprint: string;
    label: string;
}

// Human-readable "Chrome on macOS" plus a coarse fingerprint for recognizing a device
export const describeUserAgent = (userAgent: string | null | undefined): DeviceDescription => {
    if (!userAgent) return { browser: 'Unknown', os: 'Unknown', fingerprint: 'unknown', label: 'an unknown device' };

    const browser = firstMatch(userAgent, BROWSERS);
    const os = firstMatch(userAgent, OPERATING_SYSTEMS);
    const label = browser === 'Unknown' ? (os === 'Unknown' ? 'an unknown device' : os) : `${browser} on ${os}`;

    return { browser, os, fingerprint: `${browser}/${os}`.toLowerCase(), label };
};
