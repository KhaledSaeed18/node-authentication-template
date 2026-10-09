import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

// Single shared client so the whole app uses one connection pool
export const prisma = new PrismaClient({ adapter });

// The regular client or the one inside $transaction(), for helpers that write as part
// of a caller's transaction
export type DbClient = PrismaClient | Prisma.TransactionClient;
