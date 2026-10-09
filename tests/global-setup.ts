import { execSync } from 'node:child_process';

// Bring the test database schema up to date once before the whole run
export default function setup() {
    execSync('npx prisma migrate deploy', {
        stdio: 'inherit',
        env: {
            ...process.env,
            DATABASE_URL:
                process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/auth_test',
        },
    });
}
