// Run on a schedule (cron, Kubernetes CronJob, ...):
//   yarn db:cleanup                    in development
//   node dist/scripts/cleanup.js       from the production image
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { cleanupExpiredData } from '../modules/maintenance/cleanup.js';
import { durationToMs } from '../shared/utils/duration.js';

try {
    const deleted = await cleanupExpiredData(prisma, {
        loginHistoryRetentionDays: env.LOGIN_HISTORY_RETENTION_DAYS,
        securityEventRetentionDays: env.SECURITY_EVENT_RETENTION_DAYS,
        retiredSigningKeyRetentionMs: durationToMs(env.ACCESS_TOKEN_TTL) + 5 * 60 * 1000,
    });
    logger.info({ deleted }, 'Cleanup finished');
} catch (error) {
    logger.error({ err: error }, 'Cleanup failed');
    process.exitCode = 1;
} finally {
    await prisma.$disconnect();
}
