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
