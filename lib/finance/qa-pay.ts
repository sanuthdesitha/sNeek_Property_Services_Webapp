/**
 * CANONICAL QA-inspection pay math (pure — no DB, no I/O).
 *
 * The QA equivalent of `computeCleanerPay` in lib/finance/job-money.ts. A QA
 * inspection is paid work: the inspector drives to the property, runs the
 * checklist, files the report. Until now the data model had nowhere to record
 * what they were owed, so QA inspectors only ever got paid through
 * `CleanerPayAdjustment` credits (rectification pay / rework transfers).
 *
 * THREE-LEVEL PRECEDENCE — the same shape the owner already understands from
 * cleaner pay (settings default → person's rate → per-job override):
 *
 *   mode   : assignment.payMode          → settings.defaultMode
 *   fixed $: assignment.payAmount        → settings.defaultFixedAmount
 *   rate   : assignment.payHourlyRate    → inspector.hourlyRate → settings.defaultHourlyRate
 *   hours  : assignment.payHoursAllocated → actual on-site hours → settings.defaultHoursPerInspection
 *
 * The MOST SPECIFIC value always wins, at each level independently: an admin
 * can pin the hours on one inspection and leave the rate to flow from the
 * inspector's profile.
 *
 * HOURLY = rate × hours, rounded to whole cents. FIXED = the flat amount.
 * NONE = $0 (an explicitly unpaid inspection — e.g. an inspector re-checking
 * their own miss), which is NOT the same as "unconfigured": an unconfigured
 * hourly rate produces `rateMissing`, so the UI can show "rate not set" instead
 * of pretending $0 is correct.
 *
 * DOUBLE-PAY GUARD: like `CleanerPayAdjustment`, a completed inspection is money
 * owed exactly once, and two settlement rails can consume it (a payroll run or a
 * cleaner invoice). `isQaAssignmentAvailableForSettlement` is THE selector; a
 * row carrying either stamp is spent.
 */

/** QA pay modes. Stored as a plain string column (no enum migration needed). */
export type QaPayMode = "FIXED" | "HOURLY" | "NONE";

/**
 * What an assignment may carry in `payMode`. "DEFAULT" and null both mean
 * "inherit the global setting" — "DEFAULT" is accepted because it is the
 * natural value for a UI select whose first option is "Use default".
 */
export type QaPayModeOverride = QaPayMode | "DEFAULT" | null | undefined;

/** Which rule produced the amount. Surfaced to admin + inspector so the number is explainable. */
export type QaPaySource =
  | "ASSIGNMENT_FIXED"
  | "SETTINGS_FIXED"
  | "ASSIGNMENT_RATE"
  | "INSPECTOR_RATE"
  | "SETTINGS_RATE"
  | "UNPAID";

/** How `hours` was derived (HOURLY mode only). */
export type QaPayBasis = "ALLOCATED" | "ACTUAL" | "DEFAULT_HOURS" | "NONE";

export interface QaPayAssignmentInput {
  /**
   * Deliberately widened to `string` on top of `QaPayModeOverride`: the column is
   * free text (no enum migration), so a legacy or hand-edited row can hold
   * anything. `normalizeQaPayMode` treats every unrecognised value as "inherit",
   * which is the safe reading — an unparseable override must not silently
   * decide someone's pay.
   */
  payMode?: QaPayModeOverride | string;
  payAmount?: number | null;
  payHourlyRate?: number | null;
  payHoursAllocated?: number | null;
  /** On-site timer minutes recorded by the inspector (QaAssignment.onSiteMinutes). */
  onSiteMinutes?: number | null;
}

export interface QaPayInspectorInput {
  /** User.hourlyRate — the inspector-level default rate. */
  hourlyRate?: number | null;
}

export interface QaPaySettingsInput {
  defaultMode: QaPayMode;
  defaultFixedAmount: number;
  defaultHourlyRate: number;
  defaultHoursPerInspection: number;
}

export interface QaPayResult {
  /** Dollars payable for this inspection, rounded to whole cents. Never negative. */
  amount: number;
  /** The mode actually applied after the override/default resolution. */
  mode: QaPayMode;
  /** Where `hours` came from. "NONE" for FIXED/NONE modes. */
  basis: QaPayBasis;
  /** Paid hours (HOURLY only; 0 otherwise). */
  hours: number;
  /** Effective hourly rate applied (HOURLY only; 0 otherwise). */
  rate: number;
  /** Which rule produced `amount`. */
  source: QaPaySource;
  /**
   * True when the resolved rule had nothing configured to work with — an HOURLY
   * inspection with no rate anywhere, or a FIXED one with no amount anywhere.
   * The amount is 0 in that case, and the UI must say "not set" rather than
   * present $0.00 as a decided figure.
   */
  rateMissing: boolean;
}

/** Round to whole cents. Same rule as roundCents in job-money.ts (kept local so this module stays dependency-free). */
function cents(value: number): number {
  return Number((Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2));
}

/** A usable positive money/rate/hours value, or null. Rejects NaN, Infinity, ≤0. */
function positive(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A usable NON-NEGATIVE value, or null. Used for amounts/hours where an explicit
 * 0 is a meaningful admin decision ("this inspection pays nothing") and must not
 * silently fall through to the default.
 */
function nonNegative(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Coerce an arbitrary stored string into a real mode, or null when it means "inherit". */
export function normalizeQaPayMode(value: unknown): QaPayMode | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  if (upper === "FIXED" || upper === "HOURLY" || upper === "NONE") return upper;
  return null; // "DEFAULT", "", or anything unrecognised → inherit the setting.
}

export interface ComputeQaAssignmentPayInput {
  assignment: QaPayAssignmentInput;
  inspector?: QaPayInspectorInput | null;
  settings: QaPaySettingsInput;
  /**
   * Actual hours the inspector spent on site. When omitted, it is derived from
   * `assignment.onSiteMinutes`. Explicitly passing it wins (the caller may have
   * a better source, e.g. reconciled timer logs).
   */
  actualHours?: number | null;
}

/**
 * Compute what a QA inspector is paid for one inspection.
 *
 * Pure and deterministic: pass already-loaded rows, get a rounded result back.
 */
export function computeQaAssignmentPay(input: ComputeQaAssignmentPayInput): QaPayResult {
  const { assignment, inspector, settings } = input;

  const mode =
    normalizeQaPayMode(assignment.payMode) ?? normalizeQaPayMode(settings.defaultMode) ?? "NONE";

  if (mode === "NONE") {
    return {
      amount: 0,
      mode: "NONE",
      basis: "NONE",
      hours: 0,
      rate: 0,
      source: "UNPAID",
      rateMissing: false,
    };
  }

  if (mode === "FIXED") {
    // A per-assignment 0 is a real decision ("pay nothing for this one"), so
    // nonNegative — but a settings default of 0 means "not configured".
    const assignmentAmount = nonNegative(assignment.payAmount);
    const settingsAmount = positive(settings.defaultFixedAmount);
    const resolved = assignmentAmount ?? settingsAmount;
    return {
      amount: resolved == null ? 0 : cents(resolved),
      mode: "FIXED",
      basis: "NONE",
      hours: 0,
      rate: 0,
      source: assignmentAmount != null ? "ASSIGNMENT_FIXED" : "SETTINGS_FIXED",
      rateMissing: resolved == null,
    };
  }

  // ── HOURLY ────────────────────────────────────────────────────────────
  const assignmentRate = positive(assignment.payHourlyRate);
  const inspectorRate = positive(inspector?.hourlyRate);
  const settingsRate = positive(settings.defaultHourlyRate);
  const resolvedRate = assignmentRate ?? inspectorRate ?? settingsRate;
  const rateSource: QaPaySource =
    assignmentRate != null
      ? "ASSIGNMENT_RATE"
      : inspectorRate != null
      ? "INSPECTOR_RATE"
      : "SETTINGS_RATE";

  // Hours: allocated → actual on-site → settings default. An allocated 0 is a
  // real decision and must not fall through.
  const allocated = nonNegative(assignment.payHoursAllocated);
  const actualRaw =
    input.actualHours != null
      ? input.actualHours
      : assignment.onSiteMinutes != null
      ? Number(assignment.onSiteMinutes) / 60
      : null;
  // Actual hours only count when the inspector actually clocked time; a 0/absent
  // timer is "no reading", not "worked zero hours", so it falls through to the
  // configured default rather than silently paying nothing.
  const actual = positive(actualRaw);
  const defaultHours = positive(settings.defaultHoursPerInspection);

  const resolvedHours = allocated ?? actual ?? defaultHours;
  const basis: QaPayBasis =
    allocated != null ? "ALLOCATED" : actual != null ? "ACTUAL" : "DEFAULT_HOURS";

  const hours = resolvedHours ?? 0;
  const rate = resolvedRate ?? 0;

  return {
    amount: cents(hours * rate),
    mode: "HOURLY",
    basis,
    hours: Number(hours.toFixed(2)),
    rate: cents(rate),
    source: rateSource,
    // Only a MISSING RATE is a misconfiguration worth flagging: hours always
    // resolve to something (allocated/actual/default) and a default-hours
    // fallback is a legitimate configuration, not an error.
    rateMissing: resolvedRate == null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Settlement (double-pay guard)
// ─────────────────────────────────────────────────────────────────────────

/** Mirrors QaAssignmentStatus without importing @prisma/client into a pure module. */
export type QaAssignmentStatusLike =
  | "OPEN"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | string;

export interface QaSettlementRow {
  id?: string;
  status: QaAssignmentStatusLike;
  includedInPayrollRunId?: string | null;
  includedInCleanerInvoiceId?: string | null;
}

/**
 * Does this inspection count toward pay at all?
 *
 * Only a COMPLETED inspection does. An open/assigned/in-progress one is work
 * not yet done, and a CANCELLED one is work that never happened — paying either
 * would be paying for nothing. (Deliberately mirrors
 * `adjustmentCountsTowardPay`, which likewise admits exactly one status.)
 */
export function qaAssignmentCountsTowardPay(row: Pick<QaSettlementRow, "status">): boolean {
  return row.status === "COMPLETED";
}

export interface QaSettlementOptions {
  /** Recomputing this payroll run: rows it already stamped stay available. */
  includePayrollRunId?: string | null;
  /** Recomputing this cleaner invoice: rows it already stamped stay available. */
  includeInvoiceId?: string | null;
}

/**
 * Is this completed inspection still unpaid, i.e. may the NEXT payroll run /
 * invoice pick it up? Completed AND not already settled by another run/invoice.
 *
 * Byte-for-byte the same discipline as `isAdjustmentAvailableForInvoice`, and
 * for the same reason: the stamp — not the date window — is what prevents
 * double payment, so an inspection completed before a period closed but settled
 * late must still be paid exactly once.
 */
export function isQaAssignmentAvailableForSettlement(
  row: QaSettlementRow,
  options: QaSettlementOptions = {}
): boolean {
  if (!qaAssignmentCountsTowardPay(row)) return false;

  const payrollStamp = row.includedInPayrollRunId ?? null;
  if (payrollStamp && payrollStamp !== (options.includePayrollRunId ?? null)) return false;

  const invoiceStamp = row.includedInCleanerInvoiceId ?? null;
  if (invoiceStamp && invoiceStamp !== (options.includeInvoiceId ?? null)) return false;

  return true;
}

/**
 * Amount an inspection contributes to a settlement run.
 *
 * Once settled, `paySettledAmount` is frozen and wins over any recomputation —
 * a later rate change or settings edit must never retro-alter what was actually
 * paid out. Unsettled rows compute live.
 */
export function qaAssignmentSettlementAmount(
  row: { paySettledAmount?: number | null },
  computed: number
): number {
  const frozen = row.paySettledAmount;
  if (frozen != null && Number.isFinite(Number(frozen))) return cents(Number(frozen));
  return cents(computed);
}

/** Sum of the payable amounts of a list of already-computed inspection rows. */
export function sumQaPay(rows: readonly { amount: number }[]): number {
  return cents(rows.reduce((total, row) => total + (Number(row.amount) || 0), 0));
}
