import { PrismaClient } from "@prisma/client";

// Single shared client so the whole app uses one connection pool
export const prisma = new PrismaClient();
