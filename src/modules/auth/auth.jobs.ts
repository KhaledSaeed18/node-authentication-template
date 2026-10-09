import { env } from '../../config/env.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Mailer } from '../../mail/mailer.js';
import { passwordResetEmail, securityNoticeEmail, verificationEmail } from '../../mail/templates.js';
import { TooManyRequestsError } from '../../shared/errors/app-error.js';
import type { CodePurpose } from '../../generated/prisma/enums.js';
import type { OutboxHandlers } from '../outbox/outbox.js';
import { CODE_TTL_MINUTES, type VerificationCodeService } from './verification-code.service.js';

// Payloads never contain secrets: codes are generated when the email is actually sent.
// Jobs that start from an email address are enqueued whether or not the account
// exists, so the request does the same work either way.
declare module '../outbox/outbox.js' {
    interface OutboxJobs {
        'email.verification': { email: string };
        'email.password-reset': { email: string };
        'email.security-notice': { userId: string; event: string; occurredAt: string; ipAddress: string | null };
    }
}

interface AuthJobDependencies {
    db: PrismaClient;
    mailer: Mailer;
    codes: VerificationCodeService;
}

export const createAuthJobHandlers = ({
    db,
    mailer,
    codes,
}: AuthJobDependencies): Pick<OutboxHandlers, 'email.verification' | 'email.password-reset' | 'email.security-notice'> => {
    // The resend cooldown only applies to the first try; a retry after a failed send
    // must go through, otherwise a mail outage would swallow the email
    const issueCode = async (userId: string, purpose: CodePurpose, attempt: number): Promise<string | null> => {
        try {
            return await codes.issue(userId, purpose, { ignoreCooldown: attempt > 1 });
        } catch (error) {
            if (error instanceof TooManyRequestsError) return null;
            throw error;
        }
    };

    return {
        'email.verification': async ({ email }, { attempt }) => {
            const user = await db.user.findUnique({ where: { email } });
            if (!user || user.isVerified) return;

            const code = await issueCode(user.id, 'EMAIL_VERIFICATION', attempt);
            if (!code) return;

            await mailer.send(
                user.email,
                verificationEmail({ appName: env.APP_NAME, name: user.firstName, code, minutes: CODE_TTL_MINUTES })
            );
        },

        'email.password-reset': async ({ email }, { attempt }) => {
            const user = await db.user.findUnique({ where: { email } });
            if (!user) return;

            const code = await issueCode(user.id, 'PASSWORD_RESET', attempt);
            if (!code) return;

            await mailer.send(
                user.email,
                passwordResetEmail({ appName: env.APP_NAME, name: user.firstName, code, minutes: CODE_TTL_MINUTES })
            );
        },

        'email.security-notice': async ({ userId, event, occurredAt, ipAddress }) => {
            const user = await db.user.findUnique({ where: { id: userId } });
            if (!user) return;

            await mailer.send(
                user.email,
                securityNoticeEmail({ appName: env.APP_NAME, name: user.firstName, event, time: new Date(occurredAt), ipAddress })
            );
        },
    };
};
