/**
 * Per-job cleaner pay — the small pure helper the cleaner job-form route and the
 * cleaner Today page share to compute what THIS cleaner earns for ONE job.
 *
 * It wraps the canonical `computeCleanerPay` (the single source of truth) with
 * the exact same rules the daily-briefing / payroll use:
 *   - split the allocated time across the job's non-removed assignments,
 *   - honor the per-cleaner custom payout + transport allowance from job meta,
 *   - and apply the REWORK rule (lib/finance/payroll.ts): a rework job's pay is
 *     governed entirely by reworkPayAmount (null → $0), never hours×rate.
 *
 * Returns null when the cleaner has no active assignment on the job.
 */
import type { JobType } from "@prisma/client";
import { computeCleanerPay } from "@/lib/finance/job-money";

export interface JobPayForCleanerInput {
  cleanerId: string;
  job: {
    jobType: JobType;
    estimatedHours: number | null;
    isRework?: boolean | null;
    reworkPayAmount?: number | null;
  };
  /** The job's NON-REMOVED assignments (userId + per-assignment payRate snapshot). */
  assignments: Array<{ userId: string; payRate: number | null }>;
  /** The cleaner's default hourly rate (User.hourlyRate). */
  userHourlyRate: number | null;
  /** settings.cleanerJobHourlyRates — per-cleaner, per-job-type hourly rate. */
  cleanerJobHourlyRates?: Record<string, Partial<Record<JobType, number>>>;
  /** jobMeta.cleanerPayouts — per-cleaner custom payout map. */
  cleanerPayouts?: Record<string, number>;
  /** jobMeta.transportAllowances — per-cleaner transport allowance map. */
  transportAllowances?: Record<string, number>;
}

/** What this cleaner is paid for this one job, or null when not assigned. */
export function computeJobPayForCleaner(input: JobPayForCleanerInput): number | null {
  const { cleanerId, job, assignments } = input;
  const mine = assignments.find((a) => a.userId === cleanerId);
  if (!mine) return null;

  const activeCount = assignments.length || 1;

  // Rework pay is governed ENTIRELY by the QA decision (reworkPayAmount), never
  // hours×rate — an unpaid rework (reworkPayAmount null) pays $0. Mirrors the
  // payroll rule so every screen agrees.
  const reworkCustomPayout = job.isRework
    ? typeof job.reworkPayAmount === "number" && Number.isFinite(job.reworkPayAmount)
      ? job.reworkPayAmount
      : 0
    : undefined;
  const customPayout =
    reworkCustomPayout !== undefined ? reworkCustomPayout : input.cleanerPayouts?.[cleanerId];

  const pay = computeCleanerPay(
    { jobType: job.jobType, estimatedHours: job.estimatedHours },
    { payRate: mine.payRate ?? null, userHourlyRate: input.userHourlyRate ?? null },
    { cleanerJobHourlyRates: input.cleanerJobHourlyRates },
    {
      cleanerId,
      activeAssignmentCount: activeCount,
      customPayout,
      transportAllowance: input.transportAllowances?.[cleanerId],
    }
  );

  return pay.total;
}
