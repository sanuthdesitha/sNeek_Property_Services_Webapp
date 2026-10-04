import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const LEASE_MS = 5 * 60_000;
const keyFor = (jobId: string) => `job_report_generation_v1:${jobId}`;
type Lease = { token: string; leasedAt: string };

/** Serialize all report producers per job without holding a DB transaction while
 * Chromium/S3 runs. Expired workers may finish rendering, but only the current
 * lease can publish. Objects must use the returned unique storageId so a stale
 * worker cannot overwrite the winner's bytes before its DB fence rejects it. */
export async function withReportGeneration<T>(jobId: string, work: (context: {
  storageId: string;
  publish: (expectedJobUpdatedAt: Date, write: (tx: Prisma.TransactionClient) => Promise<void>) => Promise<void>;
}) => Promise<T>): Promise<T> {
  const key = keyFor(jobId);
  const token = randomUUID();
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const row = await tx.appSetting.findUnique({ where: { key } });
    const current = row?.value as unknown as Lease | undefined;
    if (current?.token && Date.now() - Date.parse(current.leasedAt) < LEASE_MS) {
      throw new Error("Report generation is already running. Try again shortly.");
    }
    const value = { token, leasedAt: new Date().toISOString() };
    await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  });

  try {
    return await work({
      storageId: token,
      publish: async (expectedJobUpdatedAt, write) => {
        await db.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
          const row = await tx.appSetting.findUnique({ where: { key } });
          if ((row?.value as unknown as Lease | undefined)?.token !== token) {
            throw new Error("Report generation was superseded. Retry using the latest job evidence.");
          }
          // Block a simultaneous job edit until the snapshot is published. A
          // changed job means QA/scope/evidence progressed during rendering.
          await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${jobId} FOR SHARE`;
          const job = await tx.job.findUnique({ where: { id: jobId }, select: { updatedAt: true } });
          if (!job || job.updatedAt.getTime() !== expectedJobUpdatedAt.getTime()) {
            throw new Error("Job changed during report generation. Retry using the latest job evidence.");
          }
          await write(tx);
        });
      },
    });
  } finally {
    // A timed-out older worker must never release a replacement worker's lease.
    await db.appSetting.deleteMany({ where: { key, value: { path: ["token"], equals: token } } });
  }
}
