// Dedicated outbox worker, for deployments that run workers separately from the API
// (set OUTBOX_WORKER_ENABLED=false on the API instances):
//   node dist/scripts/worker.js
import { buildApplication } from '../app.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

const { worker } = buildApplication();
worker.start();

const stop = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Stopping outbox worker');
    await worker.stop();
    await Promise.allSettled([prisma.$disconnect(), redis?.close()]);
    process.exit(0);
};

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
