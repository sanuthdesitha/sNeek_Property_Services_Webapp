/**
 * One clean, reduced to the inputs every Insights figure needs. Each input is
 * a `Known<T>`: a value, or the reason it is missing. Nothing here invents a
 * number.
 *
 * Definitions (repeated on screen as basis lines):
 *  - Charge (revenue): the SCHEDULED CHARGE for the clean from the canonical
 *    client-charge rule, `computeClientCharge` (fixed job price → property rate
 *    → price book), exactly as invoice generation prices a job. Not invoiced
 *    or received money. Missing when no rate resolves; a skipped clean is not
 *    billed and is excluded.
 *  - Cleaner cost: the recorded pay for the clean from the canonical per-job
 *    pay summary, `computeJobPaySummary` (rate snapshot on the assignment ×
 *    allocated hours, or clocked hours when none are allocated, or the custom /
 *    rework payout; plus transport and APPROVED adjustments), summed over every
 *    payee. The same figure the cleaner invoice and payroll produce. Missing
 *    when no cleaner is assigned, when any assigned payee has no pay rate (the
 *    pay function would otherwise fall back to a default rate), or when there
 *    are neither allocated hours nor a clocked time log to pay from.
 *  - Planned time: Job.estimatedHours (the allocated person-hours the pay rule
 *    splits across cleaners). Missing when not set.
 *  - Actual time: the sum of finished time logs. Missing when an assigned
 *    cleaner has no finished log, or any log is still running.
 *  - On time: the first clock-in is no later than ON_TIME_GRACE_MINUTES after
 *    the scheduled start (the scheduled Sydney day at Job.startTime, Sydney
 *    time). The 15 minutes are the workforce reliability rule's. Missing when
 *    the job has no start time or no time log.
 *  - QA score: the authoritative review (QA > ADMIN > AUTO, then latest), the
 *    Quality hub's rule.
 *
 * Pure: the loader passes already-read rows.
 */
import type { JobType } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { computeClientCharge, roundCents, type ClientChargeRates } from "@/lib/finance/job-money";
import { computeJobPaySummary } from "@/lib/finance/job-pay-summary";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { pickAuthoritativeReview } from "@/lib/quality/authority";
import type { CleanReview } from "@/lib/quality/cleans";
import { SYDNEY_TZ, sydneyDateKey, weekMondayKey } from "@/lib/time/sydney-range";
import { known, missing, type Known } from "./measure";

export const ON_TIME_GRACE_MINUTES = 15;

export type InsightsJobRow = {
  id: string;
  jobNumber: string | null;
  scheduledDate: Date;
  startTime: string | null;
  jobType: JobType;
  estimatedHours: number | null;
  fixedPrice: number | null;
  isRework: boolean;
  reworkPayAmount: number | null;
  internalNotes: string | null;
  cleanSkipStatus: string;
  propertyId: string;
  property: { name: string; clientId: string; client: { name: string } | null };
  assignments: Array<{
    userId: string;
    payRate: number | null;
    removedAt: Date | null;
    user: { name: string | null; email: string | null; role: string; hourlyRate: number | null } | null;
  }>;
  timeLogs: Array<{ userId: string; startedAt: Date; stoppedAt: Date | null; durationM: number | null }>;
  payAdjustments: Array<{ id: string; cleanerId: string; status: string; requestedAmount: number; approvedAmount: number | null }>;
  qaReviews: Array<{ score: number; kind: string; rating: string | null; managementReview: boolean; createdAt: Date }>;
  reworkOfJob: { assignments: Array<{ userId: string; removedAt: Date | null }> } | null;
};

export type FactContext = {
  rates: ClientChargeRates;
  cleanerJobHourlyRates: Record<string, Partial<Record<JobType, number>>>;
};

/** One cleaner's share of a clean: allocated minutes (split as pay splits them) and own logged minutes. */
export type CleanerShare = { cleanerId: string; plannedMinutes: Known<number>; actualMinutes: Known<number> };

export type JobFact = {
  jobId: string;
  jobNumber: string | null;
  scheduledAt: Date;
  dayKey: string;
  weekKey: string;
  propertyId: string;
  propertyName: string;
  clientId: string;
  clientName: string;
  jobType: JobType;
  isRework: boolean;
  /** For a rework job: the cleaners on the job being redone (who the rework counts against). */
  reworkOriginalCleanerIds: string[];
  cleanerIds: string[];
  shares: CleanerShare[];
  charge: Known<number>;
  cost: Known<number>;
  plannedMinutes: Known<number>;
  actualMinutes: Known<number>;
  onTime: Known<boolean>;
  review: CleanReview | null;
};

function activeUserIds(assignments: ReadonlyArray<{ userId: string; removedAt: Date | null }>): string[] {
  return Array.from(new Set(assignments.filter((a) => !a.removedAt).map((a) => a.userId)));
}

export function deriveCharge(row: InsightsJobRow, rates: ClientChargeRates): Known<number> {
  if (row.cleanSkipStatus === "SKIPPED") return missing("skipped_clean");
  const charge = computeClientCharge(
    { jobType: row.jobType, propertyId: row.propertyId, fixedPrice: row.fixedPrice },
    rates,
  );
  return charge.amount === null ? missing("no_client_rate") : known(charge.amount);
}

/**
 * True when a clean cannot be costed because a payee has no known pay rate: no
 * assignment snapshot, no per-cleaner job-type rate, no User.hourlyRate and no
 * custom payout (`rateMissing` from computeCleanerPay, which would otherwise
 * price it at the default rate). Insights and the Finance summary both use this
 * test, so the two pages leave out the same cleans.
 */
export function payRateUnknown(pays: ReadonlyArray<{ rateMissing: boolean }>): boolean {
  return pays.some((pay) => pay.rateMissing);
}

export function deriveCost(row: InsightsJobRow, context: FactContext): Known<number> {
  const active = row.assignments.filter((a) => !a.removedAt);
  if (active.length === 0) return missing("no_cleaner");
  const timerHoursByCleaner: Record<string, number> = {};
  for (const log of row.timeLogs) {
    if (!log.stoppedAt) continue;
    timerHoursByCleaner[log.userId] = (timerHoursByCleaner[log.userId] ?? 0) + Number(log.durationM ?? 0) / 60;
  }
  const meta = parseJobInternalNotes(row.internalNotes);
  const payees = computeJobPaySummary({
    audience: "internal",
    job: { jobType: row.jobType, estimatedHours: row.estimatedHours, isRework: row.isRework, reworkPayAmount: row.reworkPayAmount },
    assignments: row.assignments.map((a) => ({
      userId: a.userId,
      payRate: a.payRate,
      removedAt: a.removedAt,
      userName: a.user?.name ?? a.user?.email ?? null,
      userRole: a.user?.role ?? null,
      userHourlyRate: a.user?.hourlyRate ?? null,
    })),
    settings: { cleanerJobHourlyRates: context.cleanerJobHourlyRates },
    cleanerPayouts: meta.cleanerPayouts,
    transportAllowances: meta.transportAllowances,
    adjustments: row.payAdjustments.map((adj) => ({ ...adj })),
    timerHoursByCleaner,
  });
  const assigned = payees.filter((payee) => payee.assigned);
  if (payRateUnknown(assigned.map((payee) => payee.basePay))) return missing("no_pay_rate");
  const unpaidHours = assigned.some(
    (payee) => payee.basePay.source === "JOBTYPE_RATE" && payee.basePay.basis === "TIMER" && payee.basePay.hours <= 0,
  );
  if (unpaidHours) return missing("no_paid_hours");
  return known(roundCents(payees.reduce((total, payee) => total + payee.approvedTotal, 0)));
}

function plannedTotalMinutes(row: InsightsJobRow): Known<number> {
  const hours = Number(row.estimatedHours ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return missing("no_planned_time");
  return known(Math.round(hours * 60));
}

function loggedMinutes(logs: InsightsJobRow["timeLogs"]): Known<number> {
  if (logs.length === 0) return missing("no_time_log");
  if (logs.some((log) => !log.stoppedAt)) return missing("time_log_open");
  return known(logs.reduce((total, log) => total + Math.max(0, Number(log.durationM ?? 0)), 0));
}

export function deriveActual(row: InsightsJobRow): Known<number> {
  const cleaners = activeUserIds(row.assignments);
  if (row.timeLogs.some((log) => !log.stoppedAt)) return missing("time_log_open");
  const missingCleaner = cleaners.some((id) => !row.timeLogs.some((log) => log.userId === id));
  if (row.timeLogs.length === 0 || missingCleaner) return missing("no_time_log");
  return loggedMinutes(row.timeLogs);
}

function deriveShares(row: InsightsJobRow, planned: Known<number>): CleanerShare[] {
  const cleaners = activeUserIds(row.assignments);
  const split = Math.max(1, cleaners.length);
  return cleaners.map((cleanerId) => ({
    cleanerId,
    plannedMinutes: planned.reason === null ? known(Math.round(planned.value / split)) : missing(planned.reason),
    actualMinutes: loggedMinutes(row.timeLogs.filter((log) => log.userId === cleanerId)),
  }));
}

/** Scheduled start: the clean's Sydney day at its HH:mm start time, Sydney time. */
export function scheduledStart(dayKey: string, startTime: string | null): Date | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(startTime ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const clock = `${String(hours).padStart(2, "0")}:${match[2]}`;
  return fromZonedTime(`${dayKey}T${clock}:00`, SYDNEY_TZ);
}

export function deriveOnTime(row: InsightsJobRow, dayKey: string): Known<boolean> {
  const start = scheduledStart(dayKey, row.startTime);
  if (!start) return missing("no_start_time");
  if (row.timeLogs.length === 0) return missing("no_time_log");
  const firstClockIn = Math.min(...row.timeLogs.map((log) => log.startedAt.getTime()));
  return known(firstClockIn <= start.getTime() + ON_TIME_GRACE_MINUTES * 60_000);
}

export function deriveJobFact(row: InsightsJobRow, context: FactContext): JobFact {
  const dayKey = sydneyDateKey(row.scheduledDate);
  const planned = plannedTotalMinutes(row);
  const review = pickAuthoritativeReview(row.qaReviews);
  return {
    jobId: row.id,
    jobNumber: row.jobNumber,
    scheduledAt: row.scheduledDate,
    dayKey,
    weekKey: weekMondayKey(dayKey),
    propertyId: row.propertyId,
    propertyName: row.property.name,
    clientId: row.property.clientId,
    clientName: row.property.client?.name ?? "Client",
    jobType: row.jobType,
    isRework: row.isRework,
    reworkOriginalCleanerIds: row.reworkOfJob ? activeUserIds(row.reworkOfJob.assignments) : [],
    cleanerIds: activeUserIds(row.assignments),
    shares: deriveShares(row, planned),
    charge: deriveCharge(row, context.rates),
    cost: deriveCost(row, context),
    plannedMinutes: planned,
    actualMinutes: deriveActual(row),
    onTime: deriveOnTime(row, dayKey),
    review: review
      ? { score: review.score, rating: review.rating, managementReview: review.managementReview, createdAt: review.createdAt }
      : null,
  };
}
