import type { Prisma } from "@prisma/client";

/** Timestamp evidence, not assignment/acceptance or travel, proves work began. */
export function startedWorkPeriodWhere(periodStart: Date, periodEnd: Date): Prisma.JobWhereInput {
  // All previously started, uninvoiced work is eligible catch-up. The snapshot
  // identifies older work explicitly rather than losing it after a missed run.
  return { OR: [
    { timeLogs: { some: { startedAt: { lte: periodEnd } } } },
    { status: { in: ["COMPLETED", "INVOICED"] }, completedAt: { lte: periodEnd } },
  ] };
}

export type StartedWorkSnapshot = {
  jobId: string;
  jobNumber: string | null;
  status: string;
  updatedAt: string;
  completedAt: string | null;
  firstStartedAt: string | null;
  unfinishedAtCutoff: boolean;
  priorPeriodCarryover: boolean;
};

export function snapshotStartedWork(
  job: { id: string; jobNumber?: string | null; status: string; updatedAt: Date; completedAt: Date | null; timeLogs?: Array<{ startedAt: Date; stoppedAt?: Date | null }> },
  periodStart: Date,
  periodEnd: Date,
): StartedWorkSnapshot {
  const starts = validStarts(job.timeLogs ?? [], periodEnd);
  const firstStart = starts.length ? new Date(Math.min(...starts.map(date => date.getTime()))) : null;
  const unfinishedAtCutoff = !["COMPLETED", "INVOICED"].includes(job.status) || !job.completedAt || job.completedAt > periodEnd;
  return {
    jobId: job.id,
    jobNumber: job.jobNumber ?? null,
    status: job.status,
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    firstStartedAt: firstStart?.toISOString() ?? null,
    unfinishedAtCutoff,
    priorPeriodCarryover: unfinishedAtCutoff ? firstStart !== null && firstStart < periodStart : Boolean(job.completedAt && job.completedAt < periodStart),
  };
}

function validStarts(logs: Array<{ startedAt: Date; stoppedAt?: Date | null }>, cutoff: Date) {
  return logs.filter(log => Number.isFinite(log.startedAt.getTime()) && log.startedAt <= cutoff &&
    (!log.stoppedAt || (Number.isFinite(log.stoppedAt.getTime()) && log.stoppedAt >= log.startedAt)))
    .map(log => log.startedAt);
}
export function hasStartedWorkEvidence(job: {status: string; completedAt: Date | null; timeLogs?: Array<{startedAt: Date; stoppedAt?: Date | null}>}, cutoff: Date) {
  return validStarts(job.timeLogs ?? [], cutoff).length > 0 ||
    (["COMPLETED", "INVOICED"].includes(job.status) && job.completedAt !== null && Number.isFinite(job.completedAt.getTime()) && job.completedAt <= cutoff);
}
