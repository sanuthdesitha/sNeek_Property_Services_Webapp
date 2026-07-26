import "server-only";

import { QaAssignmentStatus, PayAdjustmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { computeQaAssignmentPay, qaAssignmentSettlementAmount } from "@/lib/finance/qa-pay";
import { adjustmentSignedAmount } from "@/lib/finance/pay-adjustments";
import { sydneyDayStart, sydneyDayEndInclusive } from "@/lib/time/sydney-range";

/**
 * The QA inspector's earnings view — the QA counterpart of the cleaner's
 * "My pay" screen (app/v2/cleaner/pay + lib/cleaner/invoice.ts).
 *
 * It has TWO income streams and both must show, because an inspector who only
 * ever saw one would think they were underpaid:
 *   1. INSPECTIONS  — completed QaAssignments, priced by lib/finance/qa-pay.ts.
 *   2. ADJUSTMENTS  — CleanerPayAdjustment rows where THEY are the payee. QA
 *      rectification pay and rework transfers credit the inspector, and (since
 *      the payroll fix for non-CLEANER payees) those credits do reach a run.
 *
 * Amounts are already-settled-aware: once a run or invoice stamps an
 * inspection, `paySettledAmount` is what it paid and that is what we show.
 */

export interface QaPayLine {
  id: string;
  jobId: string | null;
  jobNumber: string | null;
  property: string;
  suburb: string | null;
  completedAt: Date | null;
  mode: string;
  basis: string;
  hours: number;
  rate: number;
  amount: number;
  rateMissing: boolean;
  note: string | null;
  /** "PAID" once a payroll run / cleaner invoice has settled it, else "PENDING". */
  settlement: "PAID" | "PENDING";
  /** Raw id of the run/invoice that settled it. */
  settledBy: string | null;
  /**
   * WHICH rail settled it. Both rails can now consume an inspection, so "Paid"
   * alone is ambiguous to an inspector reconciling their own money — they need
   * to know whether to look for it on a payslip or on their own invoice.
   */
  settledVia: SettlementRail;
  /** Human label for the rail, e.g. "Paid on a pay run". Null when unsettled. */
  settledByLabel: string | null;
}

/** Which settlement rail consumed a row. */
export type SettlementRail = "PAYROLL_RUN" | "CLEANER_INVOICE" | null;

/**
 * Resolve the rail from the two stamps. A row should never carry both (every
 * writer guards on both being null), but if one somehow does, the payroll run is
 * reported: it is the rail that actually moves money out of the business.
 */
export function resolveSettlementRail(row: {
  includedInPayrollRunId?: string | null;
  includedInCleanerInvoiceId?: string | null;
}): { via: SettlementRail; id: string | null; label: string | null } {
  if (row.includedInPayrollRunId) {
    return { via: "PAYROLL_RUN", id: row.includedInPayrollRunId, label: "Paid on a pay run" };
  }
  if (row.includedInCleanerInvoiceId) {
    return {
      via: "CLEANER_INVOICE",
      id: row.includedInCleanerInvoiceId,
      label: "Billed on your invoice",
    };
  }
  return { via: null, id: null, label: null };
}

export interface QaPayAdjustmentLine {
  id: string;
  title: string;
  jobId: string | null;
  property: string | null;
  status: PayAdjustmentStatus;
  /** Signed: a deduction stays negative. */
  amount: number;
  requestedAmount: number;
  reviewedAt: Date | null;
  source: string | null;
  settlement: "PAID" | "PENDING";
  settledVia: SettlementRail;
  settledByLabel: string | null;
}

export interface QaPaySummary {
  start: Date;
  end: Date;
  inspections: QaPayLine[];
  adjustments: QaPayAdjustmentLine[];
  totals: {
    inspectionCount: number;
    inspectionHours: number;
    inspectionPay: number;
    /** Approved adjustments only (signed). */
    approvedAdjustments: number;
    /** PENDING adjustments awaiting a decision — shown separately, never in the total. */
    pendingAdjustments: number;
    /** inspectionPay + approvedAdjustments. */
    total: number;
    /** Portion of `total` already settled by a payroll run or invoice. */
    settled: number;
    /** Portion still awaiting settlement. */
    unsettled: number;
  };
}

function cents(value: number): number {
  return Number((Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2));
}

/** Default window = the current Sydney calendar month to date. */
function defaultRange(): { start: Date; end: Date } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "01";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  return {
    start: sydneyDayStart(`${y}-${m}-01`),
    end: sydneyDayEndInclusive(`${y}-${m}-${d}`),
  };
}

export async function getQaPaySummary(options: {
  inspectorId: string;
  /** YYYY-MM-DD (Sydney). Defaults to month-to-date. */
  startDate?: string;
  endDate?: string;
}): Promise<QaPaySummary> {
  const range =
    options.startDate && options.endDate
      ? {
          start: sydneyDayStart(options.startDate),
          end: sydneyDayEndInclusive(options.endDate),
        }
      : defaultRange();

  const settings = await getAppSettings();

  const [inspector, assignments, adjustmentRows] = await Promise.all([
    db.user.findUnique({
      where: { id: options.inspectorId },
      select: { id: true, hourlyRate: true },
    }),
    db.qaAssignment.findMany({
      where: {
        assignedToId: options.inspectorId,
        status: QaAssignmentStatus.COMPLETED,
        completedAt: { gte: range.start, lte: range.end },
      },
      select: {
        id: true,
        status: true,
        completedAt: true,
        onSiteMinutes: true,
        payMode: true,
        payAmount: true,
        payHourlyRate: true,
        payHoursAllocated: true,
        payNote: true,
        paySettledAmount: true,
        includedInPayrollRunId: true,
        includedInCleanerInvoiceId: true,
        job: {
          select: {
            id: true,
            jobNumber: true,
            property: { select: { name: true, suburb: true } },
          },
        },
      },
      orderBy: [{ completedAt: "desc" }],
    }),
    // Credits/deductions where this inspector is the PAYEE. `cleanerId` is a
    // misnomer inherited from the model name — it is the payee, and for QA
    // rectification pay / rework transfers that payee is the inspector.
    db.cleanerPayAdjustment.findMany({
      where: {
        cleanerId: options.inspectorId,
        OR: [
          { reviewedAt: { gte: range.start, lte: range.end } },
          { status: PayAdjustmentStatus.PENDING, requestedAt: { gte: range.start, lte: range.end } },
        ],
      },
      select: {
        id: true,
        title: true,
        jobId: true,
        status: true,
        source: true,
        requestedAmount: true,
        approvedAmount: true,
        reviewedAt: true,
        includedInPayrollRunId: true,
        includedInCleanerInvoiceId: true,
        property: { select: { name: true } },
        job: { select: { property: { select: { name: true } } } },
      },
      orderBy: [{ requestedAt: "desc" }],
    }),
  ]);

  const inspections: QaPayLine[] = assignments.map((row) => {
    const pay = computeQaAssignmentPay({
      assignment: row,
      inspector: { hourlyRate: inspector?.hourlyRate ?? null },
      settings: settings.qaPay,
    });
    const settled = resolveSettlementRail(row);
    return {
      id: row.id,
      jobId: row.job?.id ?? null,
      jobNumber: row.job?.jobNumber ?? null,
      property: row.job?.property?.name ?? "Inspection",
      suburb: row.job?.property?.suburb ?? null,
      completedAt: row.completedAt,
      mode: pay.mode,
      basis: pay.basis,
      hours: pay.hours,
      rate: pay.rate,
      amount: qaAssignmentSettlementAmount(row, pay.amount),
      rateMissing: pay.rateMissing,
      note: row.payNote ?? null,
      settlement: settled.via ? "PAID" : "PENDING",
      settledBy: settled.id,
      settledVia: settled.via,
      settledByLabel: settled.label,
    };
  });

  const adjustments: QaPayAdjustmentLine[] = adjustmentRows.map((row) => {
    const settled = resolveSettlementRail(row);
    return {
      id: row.id,
      title: row.title || row.job?.property?.name || row.property?.name || "Adjustment",
      jobId: row.jobId,
      property: row.job?.property?.name ?? row.property?.name ?? null,
      status: row.status,
      amount: adjustmentSignedAmount(row),
      requestedAmount: Number(row.requestedAmount ?? 0),
      reviewedAt: row.reviewedAt,
      source: row.source,
      settlement: settled.via ? "PAID" : "PENDING",
      settledVia: settled.via,
      settledByLabel: settled.label,
    };
  });

  const inspectionPay = cents(inspections.reduce((sum, row) => sum + row.amount, 0));
  const inspectionHours = Number(
    inspections.reduce((sum, row) => sum + row.hours, 0).toFixed(2)
  );
  // `adjustmentSignedAmount` already returns 0 for anything not APPROVED, so this
  // sum is approved-only by construction.
  const approvedAdjustments = cents(adjustments.reduce((sum, row) => sum + row.amount, 0));
  const pendingAdjustments = cents(
    adjustments
      .filter((row) => row.status === PayAdjustmentStatus.PENDING)
      .reduce((sum, row) => sum + row.requestedAmount, 0)
  );

  const settled = cents(
    inspections.filter((r) => r.settlement === "PAID").reduce((s, r) => s + r.amount, 0) +
      adjustments.filter((r) => r.settlement === "PAID").reduce((s, r) => s + r.amount, 0)
  );
  const total = cents(inspectionPay + approvedAdjustments);

  return {
    start: range.start,
    end: range.end,
    inspections,
    adjustments,
    totals: {
      inspectionCount: inspections.length,
      inspectionHours,
      inspectionPay,
      approvedAdjustments,
      pendingAdjustments,
      total,
      settled,
      unsettled: cents(total - settled),
    },
  };
}
