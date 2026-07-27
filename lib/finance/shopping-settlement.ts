/**
 * CANONICAL shopping-run settlement rules (pure — no DB, no I/O).
 *
 * Shopping is the FOURTH stream of money owed to a cleaner, alongside jobs
 * (`Job.payrollRunId`), pay adjustments (lib/finance/pay-adjustments.ts) and QA
 * inspections (lib/finance/qa-pay.ts). It is really two streams sharing one
 * `ShoppingSettlement` row:
 *
 *   • EXPENSE — money the cleaner spent out of pocket and is owed back
 *     (`ShoppingRunRecord.totals.actualTotalCost`).
 *   • TIME    — approved shopping hours, paid at the approved rate
 *     (`ShoppingRunRecord.shoppingTime.approvedAmount`).
 *
 * They settle INDEPENDENTLY: the primary payroll engine pays reimbursements but
 * has never paid shopping time, so a single run's expense can be captured by a
 * payroll run while its time is still owed. Each therefore carries its OWN
 * stamp pair rather than sharing one.
 *
 * DOUBLE-PAY GUARD (the bug this module exists to close): both selectors used to
 * filter on status + a date window ONLY. Neither consulted
 * `ShoppingSettlement.includedInPayrollRunId`, and no cleaner-invoice stamp
 * existed at all — so a reimbursement paid by a payroll run was billed again on
 * the next cleaner invoice, and two overlapping invoices/pay runs could each
 * bill it. The rule is now identical to the other three streams:
 *
 *   1. Does this row count toward pay at all?  → `shopping*CountsTowardPay`
 *   2. Has it already been settled once?       → `isShopping*AvailableForSettlement`
 *   3. How much did the settling rail pay?     → `shopping*SettlementAmount`
 *
 * A row carrying EITHER stamp is spent and must never be selected again. The
 * only exception is recomputing the very run/invoice that stamped it (pass
 * `includePayrollRunId` / `includeInvoiceId`) — the same escape hatch as
 * `isAdjustmentAvailableForInvoice` / `isQaAssignmentAvailableForSettlement`.
 *
 * THE STAMP, NOT THE DATE WINDOW, is what prevents double payment. The window
 * only decides which period a run is *displayed* in; a run whose reimbursement
 * was approved after its period closed must still be paid exactly once.
 */

/** Mirrors ShoppingRunCleanerReimbursementStatus without importing the module. */
export type ShoppingReimbursementStatusLike =
  | "NOT_APPLICABLE"
  | "READY"
  | "INVOICED"
  | "REIMBURSED"
  | string;

/** Mirrors ShoppingRunTimeStatus without importing the module. */
export type ShoppingTimeStatusLike =
  | "NOT_REQUESTED"
  | "PENDING"
  | "APPROVED"
  | "INVOICED"
  | "PAID"
  | string;

/**
 * The settlement stamps carried by a shopping run, flattened off its single
 * `ShoppingSettlement` row (or all-null when the run has no settlement yet — an
 * unsettled run, which is exactly what "available" means).
 *
 * Deliberately NOT the Prisma column names: this module stays free of schema
 * naming so the same rules can be applied to a record built in memory.
 */
export interface ShoppingSettlementStamps {
  /** Payroll run that captured the EXPENSE reimbursement. */
  expensePayrollRunId?: string | null;
  /** Cleaner invoice submission that billed the EXPENSE reimbursement. */
  expenseCleanerInvoiceId?: string | null;
  /** Expense amount frozen at settlement time. */
  expenseSettledAmount?: number | null;
  /** Payroll run that captured the approved shopping TIME. */
  timePayrollRunId?: string | null;
  /** Cleaner invoice submission that billed the approved shopping TIME. */
  timeCleanerInvoiceId?: string | null;
  /** Shopping-time amount frozen at settlement time. */
  timeSettledAmount?: number | null;
}

export interface ShoppingExpenseRow extends ShoppingSettlementStamps {
  id?: string;
  cleanerReimbursementStatus: ShoppingReimbursementStatusLike;
}

export interface ShoppingTimeRow extends ShoppingSettlementStamps {
  id?: string;
  shoppingTimeStatus: ShoppingTimeStatusLike;
}

export interface ShoppingSettlementOptions {
  /** Recomputing this payroll run: rows it already stamped stay available. */
  includePayrollRunId?: string | null;
  /** Recomputing this cleaner invoice: rows it already stamped stay available. */
  includeInvoiceId?: string | null;
}

/** Round to whole cents (kept local so this module stays dependency-free). */
function cents(value: number): number {
  return Number((Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2));
}

/**
 * Does this run's EXPENSE count toward cleaner pay at all?
 *
 * Everything except NOT_APPLICABLE does. Note this admits INVOICED and
 * REIMBURSED, unlike the old `status === "READY"` test: those statuses describe
 * what a rail DID, and answering "has it been paid already" is the stamps' job,
 * not the status string's. Keeping the status test narrow was what made the two
 * guards contradict each other — a run stamped by payroll still read as READY
 * (payroll never touches the status) and was billed again, while a run
 * recomputing its OWN invoice read as INVOICED and vanished off it.
 */
export function shoppingExpenseCountsTowardPay(
  status: ShoppingReimbursementStatusLike
): boolean {
  return status !== "NOT_APPLICABLE";
}

/**
 * Does this run's shopping TIME count toward cleaner pay at all?
 *
 * Only time an admin has APPROVED (or a rail has since marked INVOICED/PAID).
 * NOT_REQUESTED is no claim and PENDING is an unapproved one — paying either
 * would be paying for hours nobody signed off.
 */
export function shoppingTimeCountsTowardPay(status: ShoppingTimeStatusLike): boolean {
  return status === "APPROVED" || status === "INVOICED" || status === "PAID";
}

/** Shared stamp test: unstamped, or stamped by the rail asking. */
function stampsAllow(
  payrollStamp: string | null | undefined,
  invoiceStamp: string | null | undefined,
  options: ShoppingSettlementOptions
): boolean {
  const payroll = payrollStamp ?? null;
  if (payroll && payroll !== (options.includePayrollRunId ?? null)) return false;

  const invoice = invoiceStamp ?? null;
  if (invoice && invoice !== (options.includeInvoiceId ?? null)) return false;

  return true;
}

/**
 * Is this run's expense reimbursement still unpaid, i.e. may the NEXT payroll
 * run / cleaner invoice pick it up?
 */
export function isShoppingExpenseAvailableForSettlement(
  row: ShoppingExpenseRow,
  options: ShoppingSettlementOptions = {}
): boolean {
  if (!shoppingExpenseCountsTowardPay(row.cleanerReimbursementStatus)) return false;
  return stampsAllow(row.expensePayrollRunId, row.expenseCleanerInvoiceId, options);
}

/**
 * Is this run's approved shopping time still unpaid?
 *
 * Checked against the TIME stamps only — an expense reimbursement already paid
 * by payroll must not drag the (never-paid) time off the invoice with it.
 */
export function isShoppingTimeAvailableForSettlement(
  row: ShoppingTimeRow,
  options: ShoppingSettlementOptions = {}
): boolean {
  if (!shoppingTimeCountsTowardPay(row.shoppingTimeStatus)) return false;
  return stampsAllow(row.timePayrollRunId, row.timeCleanerInvoiceId, options);
}

/**
 * Amount an expense reimbursement contributes to a settlement.
 *
 * Once settled, the frozen figure wins over any recomputation — editing a
 * shopping run's line costs after it was billed must not retro-alter what
 * accounts was actually invoiced.
 */
export function shoppingExpenseSettlementAmount(
  row: Pick<ShoppingSettlementStamps, "expenseSettledAmount">,
  computed: number
): number {
  const frozen = row.expenseSettledAmount;
  if (frozen != null && Number.isFinite(Number(frozen))) return cents(Number(frozen));
  return cents(computed);
}

/** Amount approved shopping time contributes. Same freezing rule. */
export function shoppingTimeSettlementAmount(
  row: Pick<ShoppingSettlementStamps, "timeSettledAmount">,
  computed: number
): number {
  const frozen = row.timeSettledAmount;
  if (frozen != null && Number.isFinite(Number(frozen))) return cents(Number(frozen));
  return cents(computed);
}

/** Sum of the payable amounts of a list of already-computed shopping rows. */
export function sumShoppingPay(rows: readonly { amount: number }[]): number {
  return cents(rows.reduce((total, row) => total + (Number(row.amount) || 0), 0));
}
