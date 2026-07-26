/**
 * CANONICAL pay-adjustment money rules (pure — no DB, no I/O).
 *
 * Every consumer of `CleanerPayAdjustment` money (payroll runs, cleaner
 * invoices, payslips, finance summaries) must answer the same three questions,
 * and until now each answered them differently — which is how an approved
 * adjustment could be approved in the Approval Center and still change nothing
 * a cleaner was paid:
 *
 *   1. Does this row count toward pay at all?   → `adjustmentCountsTowardPay`
 *   2. How much, and with what sign?            → `adjustmentSignedAmount`
 *   3. Has it already been paid once?           → `isAdjustmentAvailableForInvoice`
 *
 * SIGN CONVENTION (load-bearing): an adjustment's amount is ALREADY signed at
 * the row level. A deduction is stored NEGATIVE (`requestedAmount: -amount`,
 * see lib/qa/rework-transfers.ts + lib/qa/rework-jobs.ts) and an addition
 * POSITIVE. Nothing downstream may clamp, abs() or Math.max(0, …) the value —
 * doing so silently deletes every deduction, which is exactly the bug this
 * module exists to prevent.
 *
 * DOUBLE-PAY GUARD: an approved adjustment is money owed exactly once. Two
 * independent settlement rails can consume it:
 *   • a payroll run  → stamps `includedInPayrollRunId`
 *   • a cleaner invoice submission → stamps `includedInCleanerInvoiceId`
 * A row carrying EITHER stamp is spent and must never be selected again. The
 * only exception is recomputing the very run/invoice that stamped it (pass
 * `includePayrollRunId` / `includeInvoiceId`), which mirrors the existing
 * `Job.payrollRunId` / `includePaidRunId` pattern.
 */

/** Mirrors PayAdjustmentStatus without importing @prisma/client into a pure module. */
export type PayAdjustmentStatusLike = "PENDING" | "APPROVED" | "REJECTED" | string;

export interface PayAdjustmentMoneyRow {
  id?: string;
  jobId?: string | null;
  status: PayAdjustmentStatusLike;
  /** Admin-decided amount. Null until a decision is made. Signed. */
  approvedAmount?: number | null;
  /** Originally requested amount, used only as a fallback. Signed. */
  requestedAmount?: number | null;
  includedInPayrollRunId?: string | null;
  includedInCleanerInvoiceId?: string | null;
}

/** Round to whole cents (kept local so this module stays dependency-free). */
function cents(value: number): number {
  return Number((Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2));
}

/**
 * THE rule for "does this adjustment change what the cleaner is paid".
 *
 * Only APPROVED counts. PENDING is a proposal, REJECTED is a refusal, and a
 * reversal back to PENDING (see the admin PATCH route) must therefore remove
 * the money again automatically.
 */
export function adjustmentCountsTowardPay(row: Pick<PayAdjustmentMoneyRow, "status">): boolean {
  return row.status === "APPROVED";
}

/**
 * Signed dollar value an adjustment contributes to pay. Negative = deduction.
 * Returns 0 for anything not APPROVED, so a caller can sum blindly.
 */
export function adjustmentSignedAmount(row: PayAdjustmentMoneyRow): number {
  if (!adjustmentCountsTowardPay(row)) return 0;
  const raw = row.approvedAmount ?? row.requestedAmount ?? 0;
  const value = Number(raw);
  return Number.isFinite(value) ? cents(value) : 0;
}

export interface AdjustmentAvailabilityOptions {
  /** Recomputing this payroll run: rows it already stamped stay available. */
  includePayrollRunId?: string | null;
  /** Recomputing this cleaner invoice: rows it already stamped stay available. */
  includeInvoiceId?: string | null;
}

/**
 * Is this approved adjustment still unpaid, i.e. may the NEXT invoice / payroll
 * run pick it up? Approved AND not already settled by another run or invoice.
 */
export function isAdjustmentAvailableForInvoice(
  row: PayAdjustmentMoneyRow,
  options: AdjustmentAvailabilityOptions = {}
): boolean {
  if (!adjustmentCountsTowardPay(row)) return false;

  const payrollStamp = row.includedInPayrollRunId ?? null;
  if (payrollStamp && payrollStamp !== (options.includePayrollRunId ?? null)) return false;

  const invoiceStamp = row.includedInCleanerInvoiceId ?? null;
  if (invoiceStamp && invoiceStamp !== (options.includeInvoiceId ?? null)) return false;

  return true;
}

export interface AdjustmentPartitionOptions extends AdjustmentAvailabilityOptions {
  /** Job ids that have their own line on the invoice being built. */
  jobIdsOnInvoice: Iterable<string>;
}

export interface AdjustmentPartition<T extends PayAdjustmentMoneyRow> {
  /** jobId → signed total, to fold into that job's line. */
  perJobTotals: Map<string, number>;
  /** Rows folded into a job line (needed so they can be stamped as included). */
  perJobRows: T[];
  /**
   * Approved, unpaid rows that have NO line to fold into — either unlinked, or
   * linked to a job that is not on this invoice (the QA-inspector credit case:
   * the QA is paid for a job they were never *assigned* to, so the job never
   * appears on their invoice and the credit used to vanish entirely).
   * These become their own invoice lines.
   */
  carryOverRows: T[];
  /** Every row that this invoice will settle — stamp these on submission. */
  includedRows: T[];
  /** Rows skipped because they are unapproved or already settled elsewhere. */
  skippedRows: T[];
}

/**
 * Split approved adjustments into "folds into an existing job line" vs
 * "needs its own carry-over line", dropping anything already settled.
 *
 * Selection = APPROVED **and** not yet included. Nothing else. In particular
 * there is deliberately no date window here: an adjustment approved after its
 * job's period closed must still be paid on the NEXT invoice rather than being
 * silently dropped for being "out of period".
 */
export function partitionAdjustmentsForInvoice<T extends PayAdjustmentMoneyRow>(
  rows: readonly T[],
  options: AdjustmentPartitionOptions
): AdjustmentPartition<T> {
  const jobIds = new Set(options.jobIdsOnInvoice);
  const perJobTotals = new Map<string, number>();
  const perJobRows: T[] = [];
  const carryOverRows: T[] = [];
  const skippedRows: T[] = [];

  for (const row of rows) {
    if (!isAdjustmentAvailableForInvoice(row, options)) {
      skippedRows.push(row);
      continue;
    }
    const amount = adjustmentSignedAmount(row);
    const jobId = row.jobId ?? null;
    if (jobId && jobIds.has(jobId)) {
      perJobTotals.set(jobId, cents((perJobTotals.get(jobId) ?? 0) + amount));
      perJobRows.push(row);
    } else {
      carryOverRows.push(row);
    }
  }

  return {
    perJobTotals,
    perJobRows,
    carryOverRows,
    includedRows: [...perJobRows, ...carryOverRows],
    skippedRows,
  };
}

/** Sum of the signed amounts of approved rows (0 for an empty list). */
export function sumAdjustments(rows: readonly PayAdjustmentMoneyRow[]): number {
  return cents(rows.reduce((total, row) => total + adjustmentSignedAmount(row), 0));
}
