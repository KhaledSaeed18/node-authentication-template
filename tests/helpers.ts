import type { Mailer, MailContent } from '../src/mail/mailer.js';
import { prisma } from '../src/lib/prisma.js';

export const resetDatabase = async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    if (tables.length === 0) return;
    const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};

export const API = '/api/v1';

export const strongPassword = 'Sup3r$ecretPass';

// Collects emails instead of sending them
export class InMemoryMailer implements Mailer {
    readonly sent: { to: string; content: MailContent }[] = [];

    async send(to: string, content: MailContent): Promise<void> {
        this.sent.push({ to, content });
    }

    // Last 6 digit code emailed to this address, optionally filtered by subject
    lastCode(to: string, subjectIncludes?: string): string {
        const mail = this.sent.findLast(
            (m) => m.to === to && (!subjectIncludes || m.content.subject.includes(subjectIncludes))
        );
        const code = mail?.content.text.match(/\b(\d{6})\b/)?.[1];
        if (!code) throw new Error(`No code emailed to ${to}`);
        return code;
    }

    clear() {
        this.sent.length = 0;
    }
}

// Retries an assertion until it passes, for work that finishes in the background
export const eventually = async <T>(check: () => T | Promise<T>, timeoutMs = 2000): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            return await check();
        } catch (error) {
            if (Date.now() > deadline) throw error;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
};
