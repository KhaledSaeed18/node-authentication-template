import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Single shared client so the whole app uses one connection pool
export const prisma = new PrismaClient({ adapter });
