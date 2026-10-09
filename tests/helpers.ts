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
