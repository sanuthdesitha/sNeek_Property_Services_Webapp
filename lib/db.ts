import { PrismaClient } from "@prisma/client";
import { dispatchMobilePushForNotifications } from "@/lib/notifications/mobile-push";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const db =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

db.$use(async (params, next) => {
  const result = await next(params);

  if (params.model !== "Notification") {
    return result;
  }

  if (params.action === "create") {
    await dispatchMobilePushForNotifications(db, [result]);
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
      await dispatchMobilePushForNotifications(db, pushRows);
    }
  }

  return result;
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
