/**
 * Thin DB LOADER for the canonical per-job pay summary.
 *
 * Deliberately a separate module from lib/finance/job-pay-summary.ts: that one
 * is PURE and is imported by client components (the shared pay-adjustment list,
 * the finance adjustments manager), so it must never pull `lib/db` — even
 * behind a dynamic import, which would still emit a client chunk containing
 * server code. Server routes import this file; the UI imports the pure core.
 */
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { computeJobPaySummary, type CleanerJobPaySummary } from "@/lib/finance/job-pay-summary";

/** Load everything `computeJobPaySummary` needs for one job and run it. */
export async function loadJobPaySummary(jobId: string): Promise<{
  jobId: string;
  jobNumber: string | null;
  propertyName: string | null;
  payees: CleanerJobPaySummary[];
} | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      estimatedHours: true,
      isRework: true,
      reworkPayAmount: true,
      internalNotes: true,
      property: { select: { name: true } },
      assignments: {
        select: {
          userId: true,
          payRate: true,
          removedAt: true,
          user: { select: { id: true, name: true, email: true, role: true, hourlyRate: true } },
        },
      },
    },
  });
  if (!job) return null;

  const [settings, adjustments, timeLogs] = await Promise.all([
    getAppSettings(),
    db.cleanerPayAdjustment.findMany({
      where: { jobId },
      select: {
        id: true,
        cleanerId: true,
        title: true,
        status: true,
        requestedAmount: true,
        approvedAmount: true,
        cleanerNote: true,
        adminNote: true,
        source: true,
        sourceKey: true,
        requestedAt: true,
        reviewedAt: true,
        includedInPayrollRunId: true,
        includedInCleanerInvoiceId: true,
        includedInCleanerInvoiceAt: true,
        cleaner: { select: { name: true, email: true, role: true } },
        reviewedBy: { select: { name: true, email: true } },
      },
      orderBy: { requestedAt: "asc" },
    }),
    db.timeLog.findMany({
      where: { jobId, stoppedAt: { not: null } },
      select: { userId: true, durationM: true },
    }),
  ]);

  const timerHoursByCleaner: Record<string, number> = {};
  for (const log of timeLogs) {
    timerHoursByCleaner[log.userId] =
      (timerHoursByCleaner[log.userId] ?? 0) + Number(log.durationM ?? 0) / 60;
  }

  const meta = parseJobInternalNotes(job.internalNotes);

  const payees = computeJobPaySummary({
    job: {
      jobType: job.jobType,
      estimatedHours: job.estimatedHours,
      isRework: job.isRework,
      reworkPayAmount: job.reworkPayAmount,
    },
    assignments: job.assignments.map((a) => ({
      userId: a.userId,
      payRate: a.payRate ?? null,
      removedAt: a.removedAt,
      userName: a.user?.name ?? a.user?.email ?? null,
      userRole: a.user?.role ?? null,
      userHourlyRate: a.user?.hourlyRate ?? null,
    })),
    settings: { cleanerJobHourlyRates: settings.cleanerJobHourlyRates },
    cleanerPayouts: meta.cleanerPayouts,
    transportAllowances: meta.transportAllowances,
    adjustments: adjustments.map((adj) => ({
      id: adj.id,
      cleanerId: adj.cleanerId,
      cleanerName: adj.cleaner?.name ?? adj.cleaner?.email ?? null,
      cleanerRole: adj.cleaner?.role ?? null,
      title: adj.title,
      cleanerNote: adj.cleanerNote,
      adminNote: adj.adminNote,
      status: adj.status,
      requestedAmount: adj.requestedAmount,
      approvedAmount: adj.approvedAmount,
      source: adj.source,
      sourceKey: adj.sourceKey,
      requestedAt: adj.requestedAt,
      reviewedAt: adj.reviewedAt,
      reviewedByName: adj.reviewedBy?.name ?? adj.reviewedBy?.email ?? null,
      includedInPayrollRunId: adj.includedInPayrollRunId,
      includedInCleanerInvoiceId: adj.includedInCleanerInvoiceId,
      includedInCleanerInvoiceAt: adj.includedInCleanerInvoiceAt,
    })),
    timerHoursByCleaner,
  });

  return {
    jobId: job.id,
    jobNumber: job.jobNumber ?? null,
    propertyName: job.property?.name ?? null,
    payees,
  };
}
