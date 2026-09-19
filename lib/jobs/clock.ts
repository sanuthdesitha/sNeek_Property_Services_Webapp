import { JobStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Stopping a cleaner's clock on a job.
 *
 * Extracted because there are now two ways to do it — the Stop button in the
 * workspace and a second tap on the property's NFC tag — and the sequence has
 * two parts that must not come apart: closing the open TimeLog, and moving the
 * job back to PAUSED. A tap that closed the log without moving the status, or
 * moved the status without closing the log, would leave either a job that looks
 * active with no running clock, or a clock that runs all night.
 *
 * PAUSED rather than anything more final: clocking out is not submitting. The
 * form is still unfilled, and the cleaner may be coming back after lunch.
 */
export interface ClockOutResult {
  /** False when there was no running clock to stop. */
  stopped: boolean;
  /** Minutes recorded on the log that was closed. */
  durationM: number;
}

export async function clockOutCleaner(input: {
  jobId: string;
  userId: string;
  now?: Date;
  tx?: Prisma.TransactionClient;
}): Promise<ClockOutResult> {
  if (!input.tx) return db.$transaction(tx => clockOutCleaner({ ...input, tx }));
  const client = input.tx;
  await client.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${input.jobId} FOR UPDATE`;
  const now = input.now ?? new Date();

  const openLog = await client.timeLog.findFirst({
    where: { jobId: input.jobId, userId: input.userId, stoppedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });

  if (!openLog) return { stopped: false, durationM: 0 };

  const durationM = Math.max(
    0,
    Math.round((now.getTime() - openLog.startedAt.getTime()) / 60_000)
  );

  await client.timeLog.update({
    where: { id: openLog.id },
    data: { stoppedAt: now, durationM },
  });

  // Only move an actively-running job back — never drag one that has advanced
  // to SUBMITTED/QA_REVIEW/COMPLETED/INVOICED. A stale open log, or another
  // cleaner clocking out of a shared job, must not reopen finished work.
  await client.job.updateMany({
    where: {
      id: input.jobId,
      status: JobStatus.IN_PROGRESS,
      cleanSkipStatus: { not: "SKIPPED" },
    },
    data: { status: JobStatus.PAUSED },
  });

  return { stopped: true, durationM };
}
