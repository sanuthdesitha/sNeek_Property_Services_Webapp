import "server-only";
import { markNewJobLaundryArea } from "@/lib/forms/laundry-area";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { markMobileOutboxRows } from "@/lib/notifications/mobile-outbox-marker";
import { canUseNodePrisma, getDatabaseUrl, isEdgeLikeRuntime } from "@/lib/database-runtime";

const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client");

type PrismaGlobal = {
  prisma?: PrismaClientType;
  prismaHasNotificationMiddleware?: boolean;
  prismaInitWarned?: boolean;
};

const globalForPrisma = global as unknown as PrismaGlobal;

function buildUnavailableMessage() {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    return "Prisma client is unavailable because DATABASE_URL is missing.";
  }

  if (isEdgeLikeRuntime()) {
    return "Prisma client is unavailable in an edge runtime.";
  }

  return "Prisma client is unavailable because DATABASE_URL is not a supported postgres connection string.";
}

function createUnavailableDb() {
  const message = buildUnavailableMessage();
  const fail = () => {
    throw new Error(message);
  };

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "$connect" || prop === "$disconnect") {
          return async () => undefined;
        }
        if (prop === "$use" || prop === "$on") {
          return () => undefined;
        }
        return new Proxy(fail, {
          apply() {
            fail();
          },
          get() {
            fail();
          },
        });
      },
    }
  ) as PrismaClientType;
}

function registerNotificationMiddleware(prisma: PrismaClientType) {
  if (globalForPrisma.prismaHasNotificationMiddleware) {
    return prisma;
  }

  prisma.$use(async (params, next) => {
    // Only annotate the inserted row. It commits/rolls back with its domain
    // transaction. A dedicated worker dispatches committed rows afterward.
    if (params.model === "Notification" && ["create", "createMany"].includes(params.action)) {
      params.args.data = markMobileOutboxRows(params.args.data);
    }
    // Stamp the new job's form version in its own transaction. No template,
    // existing-job or draft writes are performed by this rollout.
    if (params.model === "Job") {
      if (params.action === "create") params.args.data = markNewJobLaundryArea(params.args.data);
      if (params.action === "createMany") params.args.data = Array.isArray(params.args.data)
        ? params.args.data.map(markNewJobLaundryArea) : markNewJobLaundryArea(params.args.data);
      if (params.action === "upsert") params.args.create = markNewJobLaundryArea(params.args.create);
    }
    return next(params);
  });

  globalForPrisma.prismaHasNotificationMiddleware = true;
  return prisma;
}

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  }) as PrismaClientType;
}

function resolveDbClient() {
  if (!canUseNodePrisma()) {
    if (process.env.NODE_ENV !== "production" && !globalForPrisma.prismaInitWarned) {
      console.warn(`[db] ${buildUnavailableMessage()}`);
      globalForPrisma.prismaInitWarned = true;
    }
    return createUnavailableDb();
  }

  const prisma = registerNotificationMiddleware(globalForPrisma.prisma ?? createPrismaClient());

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
  }

  return prisma;
}

export const db = resolveDbClient();
