import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient; pool: pg.Pool };

// @ts-expect-error edge runtime check
const isEdge = typeof EdgeRuntime === "string";

function createPrismaClient(): PrismaClient {
  const pool = globalForPrisma.pool ?? new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.pool = pool;
  }

  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? (
  isEdge
    ? null as unknown as PrismaClient
    : createPrismaClient()
);

if (process.env.NODE_ENV !== "production" && !isEdge) {
  globalForPrisma.prisma = prisma;
}

export default prisma;
