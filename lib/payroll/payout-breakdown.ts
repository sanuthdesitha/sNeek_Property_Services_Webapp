import "server-only";
/**
 * What makes up one payout (board "Pay run", 2026-11-17), read from what this
 * run stamped, never recomputed:
 *
 *  - jobs: every job whose pay-run stamp (`Job.payrollRunId`) is this run and
 *    on which this person holds an assignment, with the rate snapshot stored
 *    on that assignment when the job was assigned (`JobAssignment.payRate`) and
 *    the holiday multiplier recorded in the job's holiday-rate snapshot. The
 *    pay-run rail stores no per-job amount, so none is shown;
 *  - shopping reimbursements this run settled, at their frozen settled amount;
 *  - approved adjustments this run stamped, at their signed approved amount;
 *  - QA inspections this run settled, at their frozen settled amount.
 *
 * A figure that is not stored is null and the page says "Not stored".
 */
import { db } from "@/lib/db";
import { adjustmentSignedAmount } from "@/lib/finance/pay-adjustments";
import { holidayRateSnapshotKey } from "@/lib/finance/holiday-rates";
import { sydneyDateKey } from "@/lib/time/sydney-range";
import { calendarDay } from "@/components/v2/admin/pay-records/format";

export type PayoutBreakdownJob = {
  jobId: string;
  jobNumber: string | null;
  propertyName: string;
  /** Calendar day (yyyy-MM-dd, organisation calendar), never shifted. */
  day: string;
  /** The assignment's stored rate; null when the assignment carries none. */
  rateSnapshot: number | null;
  /** Holiday multiplier from the job's applied holiday-rate snapshot, when one exists. */
  holidayMultiplier: number | null;
  /** The person was later taken off the job; the stamp still records this run. */
  assignmentRemoved: boolean;
};

export type PayoutBreakdownLine = { id: string; label: string; detail: string | null; amount: number | null };

export type PayoutBreakdown = {
  payoutId: string;
  jobs: PayoutBreakdownJob[];
  shopping: PayoutBreakdownLine[];
  adjustments: PayoutBreakdownLine[];
  inspections: PayoutBreakdownLine[];
};

type HolidaySnapshot = { state?: string; cleaners?: Array<{ id?: string; multiplier?: number }> };

function holidayMultiplierFor(value: unknown, cleanerId: string): number | null {
  const snapshot = value as HolidaySnapshot | null;
  if (!snapshot || snapshot.state !== "APPLIED" || !Array.isArray(snapshot.cleaners)) return null;
  const entry = snapshot.cleaners.find((row) => row?.id === cleanerId);
  return typeof entry?.multiplier === "number" && Number.isFinite(entry.multiplier) && entry.multiplier !== 1 ? entry.multiplier : null;
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function loadJobs(runId: string, cleanerId: string): Promise<PayoutBreakdownJob[]> {
  const jobs = await db.job.findMany({
    where: { payrollRunId: runId, assignments: { some: { userId: cleanerId } } },
    select: {
      id: true,
      jobNumber: true,
      scheduledDate: true,
      property: { select: { name: true } },
      assignments: { where: { userId: cleanerId }, select: { payRate: true, removedAt: true } },
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
  });
  const snapshots = jobs.length
    ? await db.appSetting.findMany({ where: { key: { in: jobs.map((job) => holidayRateSnapshotKey(job.id)) } } })
    : [];
  const snapshotByKey = new Map(snapshots.map((row) => [row.key, row.value]));
  return jobs.map((job) => {
    const assignment = job.assignments[0];
    return {
      jobId: job.id,
      jobNumber: job.jobNumber ?? null,
      propertyName: job.property?.name ?? "Property",
      day: sydneyDateKey(job.scheduledDate),
      rateSnapshot: finiteOrNull(assignment?.payRate),
      holidayMultiplier: holidayMultiplierFor(snapshotByKey.get(holidayRateSnapshotKey(job.id)), cleanerId),
      assignmentRemoved: Boolean(assignment?.removedAt),
    };
  });
}

async function loadShopping(runId: string, cleanerId: string): Promise<PayoutBreakdownLine[]> {
  const settlements = await db.shoppingSettlement.findMany({
    where: { includedInPayrollRunId: runId },
    select: { id: true, paidByUserId: true, paySettledAmount: true, shoppingRun: { select: { title: true, ownerUserId: true, approvedAt: true } } },
  });
  return settlements
    .filter((row) => (row.paidByUserId?.trim() || row.shoppingRun?.ownerUserId) === cleanerId)
    .map((row) => ({
      id: row.id,
      label: `Shopping: ${row.shoppingRun?.title ?? "Shopping run"}`,
      detail: row.shoppingRun?.approvedAt ? `approved ${calendarDay(sydneyDateKey(row.shoppingRun.approvedAt))}` : null,
      amount: finiteOrNull(row.paySettledAmount),
    }));
}

async function loadAdjustments(runId: string, cleanerId: string): Promise<PayoutBreakdownLine[]> {
  const rows = await db.cleanerPayAdjustment.findMany({
    where: { includedInPayrollRunId: runId, cleanerId },
    select: { id: true, title: true, status: true, requestedAmount: true, approvedAmount: true, reviewedAt: true, job: { select: { jobNumber: true } } },
    orderBy: { requestedAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    label: `${row.title?.trim() || "Pay adjustment"}${row.job?.jobNumber ? `, ${row.job.jobNumber}` : ""}`,
    detail: row.reviewedAt ? `approved ${calendarDay(sydneyDateKey(row.reviewedAt))}` : null,
    amount: adjustmentSignedAmount(row),
  }));
}

async function loadInspections(runId: string, cleanerId: string): Promise<PayoutBreakdownLine[]> {
  const rows = await db.qaAssignment.findMany({
    where: { includedInPayrollRunId: runId, assignedToId: cleanerId },
    select: { id: true, paySettledAmount: true, job: { select: { jobNumber: true, property: { select: { name: true } } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    label: `QA inspection${row.job?.jobNumber ? `, ${row.job.jobNumber}` : ""}`,
    detail: row.job?.property?.name ?? null,
    amount: finiteOrNull(row.paySettledAmount),
  }));
}

/** Null when the payout is not on this run. */
export async function loadPayoutBreakdown(runId: string, payoutId: string): Promise<PayoutBreakdown | null> {
  const payout = await db.payout.findFirst({ where: { id: payoutId, payrollRunId: runId }, select: { id: true, cleanerId: true } });
  if (!payout) return null;
  const [jobs, shopping, adjustments, inspections] = await Promise.all([
    loadJobs(runId, payout.cleanerId),
    loadShopping(runId, payout.cleanerId),
    loadAdjustments(runId, payout.cleanerId),
    loadInspections(runId, payout.cleanerId),
  ]);
  return { payoutId, jobs, shopping, adjustments, inspections };
}
