import { type AppDependencies, buildApplication } from '../src/app.js';
import type { Mailer, MailContent } from '../src/mail/mailer.js';
import type { OutboxWorker } from '../src/modules/outbox/outbox.worker.js';
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

    // Called before reading, to deliver emails still waiting in the outbox
    constructor(private readonly flush?: () => Promise<void>) {}

    async send(to: string, content: MailContent): Promise<void> {
        this.sent.push({ to, content });
    }

    // Last 6 digit code emailed to this address, optionally filtered by subject
    async lastCode(to: string, subjectIncludes?: string): Promise<string> {
        await this.flush?.();
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

// App, in-memory mailer and outbox worker wired together. Emails are sent by the
// worker, so tests drain it (mailer.lastCode does that automatically).
export const createTestApp = (overrides: Partial<AppDependencies> = {}) => {
    // The mailer needs the worker and the worker needs the mailer, hence the holder
    const holder: { worker?: OutboxWorker } = {};
    const mailer = new InMemoryMailer(async () => holder.worker?.drain());
    const { app, worker } = buildApplication({ mailer, ...overrides });
    holder.worker = worker;
    return { app, mailer, worker };
};

