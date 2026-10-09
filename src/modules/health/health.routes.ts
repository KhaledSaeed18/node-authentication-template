import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';

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

    // Ready to take traffic: dependencies reachable and not shutting down
    router.get('/ready', async (_req, res) => {
        if (state.shuttingDown) {
            res.status(503).json({ status: 'shutting_down' });
            return;
        }

        const checks: Record<string, 'ok' | 'error'> = {};

        const run = async (name: string, check: () => Promise<unknown>) => {
            try {
                await check();
                checks[name] = 'ok';
            } catch (error) {
                // Mounted before the request logger, so use the base logger
                logger.error({ err: error, check: name }, 'Readiness check failed');
                checks[name] = 'error';
            }
        };

        const client = redis;
        await Promise.all([
            run('database', () => db.$queryRaw`SELECT 1`),
            client && run('redis', () => client.ping()),
        ]);

        const ready = Object.values(checks).every((result) => result === 'ok');
        res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable', checks });
    });

    return router;
};
