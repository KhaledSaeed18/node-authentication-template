import { describe, expect, it } from 'vitest';
import { passwordResetEmail, securityNoticeEmail, verificationEmail } from '../src/mail/templates.js';

describe('email templates', () => {
    it('fills in the code, name, app name and expiry', () => {
        const mail = verificationEmail({ appName: 'Acme', name: 'Jane', code: '123456', minutes: 15 });

        expect(mail.subject).toContain('Acme');
        for (const part of [mail.html, mail.text]) {
            expect(part).toContain('123456');
            expect(part).toContain('Jane');
            expect(part).toContain('15 minutes');
        }
        expect(mail.html).not.toMatch(/\{(name|code|appName|minutes)\}/);
    });

    it('escapes HTML in interpolated values', () => {
        const mail = passwordResetEmail({ appName: 'Acme', name: '<img src=x onerror=alert(1)>', code: '123456', minutes: 15 });

        expect(mail.html).not.toContain('<img src=x');
        expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('builds security notices with the time and IP', () => {
        const mail = securityNoticeEmail({
            appName: 'Acme',
            name: 'Jane',
            event: 'Your password was changed',
            time: new Date('2026-01-02T03:04:05Z'),
            ipAddress: '203.0.113.7',
        });

        expect(mail.subject).toBe('Acme: your password was changed');
        expect(mail.text).toContain('Fri, 02 Jan 2026 03:04:05 GMT from IP address 203.0.113.7');
        expect(mail.html).toContain('203.0.113.7');
    });
});

