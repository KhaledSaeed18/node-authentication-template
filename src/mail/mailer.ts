import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface MailContent {
    subject: string;
    html: string;
    text: string;
}

export interface Mailer {
    send(to: string, content: MailContent): Promise<void>;
}

// Sends through any nodemailer transport (SMTP server or Gmail OAuth2)
class NodemailerMailer implements Mailer {
    constructor(
        private readonly transporter: Transporter,
        private readonly from: string
    ) {}

    async send(to: string, { subject, html, text }: MailContent): Promise<void> {
        await this.transporter.sendMail({ from: this.from, to, subject, html, text });
    }
}

// Logs emails instead of sending them, for local development
class ConsoleMailer implements Mailer {
    async send(to: string, { subject, text }: MailContent): Promise<void> {
        logger.info({ to, subject }, `Email (not sent, MAIL_TRANSPORT=console):\n${text}`);
    }
}

export const createMailer = (env: Env): Mailer => {
    switch (env.MAIL_TRANSPORT) {
        case 'smtp':
            return new NodemailerMailer(
                nodemailer.createTransport({
                    host: env.SMTP_HOST,
                    port: env.SMTP_PORT,
                    secure: env.SMTP_SECURE,
                    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
                }),
                env.MAIL_FROM
            );
        case 'gmail':
            // Nodemailer exchanges and refreshes the OAuth2 access token by itself
            return new NodemailerMailer(
                nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        type: 'OAuth2',
                        user: env.GMAIL_USER,
                        clientId: env.GMAIL_CLIENT_ID,
                        clientSecret: env.GMAIL_CLIENT_SECRET,
                        refreshToken: env.GMAIL_REFRESH_TOKEN,
                    },
                }),
                env.MAIL_FROM
            );
        case 'console':
            if (env.NODE_ENV === 'production') {
                logger.warn('MAIL_TRANSPORT=console in production: emails are logged, not sent');
            }
            return new ConsoleMailer();
    }
};
