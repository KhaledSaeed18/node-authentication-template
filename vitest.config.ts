import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        globalSetup: ['./tests/global-setup.ts'],
        // Tests share one database, so run files one after another
        fileParallelism: false,
        env: {
            NODE_ENV: 'test',
            // Vite sets BASE_URL to '/' for its own use, pin ours explicitly
            BASE_URL: '/api',
            API_VERSION: 'v1',
            DATABASE_URL:
                process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/auth_test',
            ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
            RATE_LIMIT_ENABLED: 'false',
            OUTBOX_WORKER_ENABLED: 'false',
        },
    },
});
