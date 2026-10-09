import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { logger } from '../../lib/logger.js';

export interface HealthState {
    shuttingDown: boolean;
}

// Liveness and readiness probes for load balancers, Docker and Kubernetes
export const createHealthRouter = (db: PrismaClient, state: HealthState): Router => {
    const router = Router();

    // The process is up
    router.get('/health', (_req, res) => {
        res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
    });

    // Ready to take traffic: database reachable and not shutting down
    router.get('/ready', async (_req, res) => {
        if (state.shuttingDown) {
            res.status(503).json({ status: 'shutting_down' });
            return;
        }

        try {
            await db.$queryRaw`SELECT 1`;
            res.json({ status: 'ready', checks: { database: 'ok' } });
        } catch (error) {
            // Mounted before the request logger, so use the base logger
            logger.error({ err: error }, 'Readiness check failed');
            res.status(503).json({ status: 'unavailable', checks: { database: 'error' } });
        }
    });

    return router;
};
