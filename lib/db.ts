import "server-only";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { dispatchMobilePushForNotifications } from "@/lib/notifications/mobile-push";
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
    const result = await next(params);

    if (params.model !== "Notification") {
      return result;
    }

    if (params.action === "create") {
      await dispatchMobilePushForNotifications(prisma as any, [result]);
      return result;
    }

    if (params.action === "createMany") {
      const data = Array.isArray(params.args?.data) ? params.args.data : [params.args?.data];
      const pushRows = data
        .filter((row: any) => row?.channel === "PUSH" && typeof row?.userId === "string")
        .map((row: any) => ({
          id: `createMany:${row.userId}:${row.jobId ?? "none"}:${row.subject ?? ""}:${row.body ?? ""}`,
          userId: row.userId,
          jobId: row.jobId ?? null,
          subject: row.subject ?? null,
          body: String(row.body ?? ""),
        }));

      if (pushRows.length > 0) {
        await dispatchMobilePushForNotifications(prisma as any, pushRows);
      }
    }

    return result;
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
