import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const health = { shuttingDown: false };
const app = createApp({ health });

const server = app.listen(env.PORT, (error) => {
    if (error) {
        logger.fatal({ err: error }, 'Failed to start server');
        process.exit(1);
    }
    logger.info(`Server is running on: http://localhost:${env.PORT}`);
});

let shuttingDown = false;

// Stop accepting connections, let in-flight requests finish, then close the DB pool
const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    health.shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    const forceExit = setTimeout(() => {
        logger.error('Graceful shutdown timed out, forcing exit');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(async (error) => {
        if (error) logger.error({ err: error }, 'Error while closing the HTTP server');
        await prisma.$disconnect();
        logger.info('Shutdown complete');
        process.exit(error ? 1 : 0);
    });
    server.closeIdleConnections();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
});
