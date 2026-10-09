import { describe, expect, it } from 'vitest';
import { passwordResetEmail, verificationEmail } from '../src/mail/templates.js';

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
});
