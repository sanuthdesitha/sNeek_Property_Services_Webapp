/**
 * QA rework money/time INVARIANTS (Phase 4 · Stage 1).
 *
 * The rework pipeline moves real money between cleaners: a reassigned rework
 * pays the new cleaner and deducts the SAME amount from the original one. Every
 * mutation in that pipeline must hold six invariants. This module is the single
 * place they are written down and the single place they are enforced — call the
 * relevant `assert*` from every rework/pay mutation you touch.
 *
 * THE INVARIANTS
 *   1. A rework job is invoiceable (carries a positive payee payment) if and only
 *      if the payee is NOT the original cleaner. Same cleaner ⇒ $0, always.
 *   2. On the different-cleaner path the deduction taken off the original cleaner
 *      equals (in magnitude) the payment made to the payee.
 *   3. `Job.reworkDeductionApplied` is set at most once — a rework can never be
 *      deducted twice (dedupe on (source, sourceKey) as well as the flag).
 *   4. EVERY auto-generated pay adjustment carries `source` + `sourceKey` so it
 *      can be deduped, traced and reversed.
 *   5. Nothing enters payroll while PENDING — a PENDING adjustment must have no
 *      approved amount and no payroll run stamped on it.
 *   6. QA self-rework minutes stay within a sane bound of the inspector's on-site
 *      window (you cannot claim two hours of rework on a 20-minute visit).
 *
 * VIOLATIONS throw a descriptive `ReworkInvariantError` AND write an AuditLog row
 * with action "INVARIANT_VIOLATION" (best-effort, via `auditInvariantViolation`;
 * the audit write can never mask the throw).
 *
 * This module is PURE — no `@/lib/db` import at module scope — so it is unit
 * testable and safe to import from anywhere. The audit writer lazily imports the
 * db inside a try/catch.
 */

export type ReworkInvariantCode =
  | "INVOICEABLE_PAYEE_MISMATCH"
  | "DEDUCTION_PAYMENT_MISMATCH"
  | "DOUBLE_DEDUCTION"
  | "MISSING_ADJUSTMENT_PROVENANCE"
  | "PENDING_IN_PAYROLL"
  | "SELF_REWORK_MINUTES_OUT_OF_BOUNDS";

export interface InvariantAuditContext {
  /** Who triggered the mutation (AuditLog.userId is required — omit to skip). */
  actorUserId?: string | null;
  jobId?: string | null;
  entity?: string;
  entityId?: string | null;
}

export class ReworkInvariantError extends Error {
  readonly code: ReworkInvariantCode;
  readonly details: Record<string, unknown>;
  constructor(code: ReworkInvariantCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ReworkInvariantError";
    this.code = code;
    this.details = details;
  }
}

/** Cents-precision rounding (local so this module stays dependency-free). */
function cents(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Write the violation to the audit trail. Best-effort and never throws — the
 * caller always rethrows the invariant error itself.
 */
export async function auditInvariantViolation(
  error: ReworkInvariantError,
  ctx: InvariantAuditContext = {}
): Promise<void> {
  if (!ctx.actorUserId) return;
  try {
    const { db } = (await import("@/lib/db")) as typeof import("@/lib/db");
    await db.auditLog.create({
      data: {
        userId: ctx.actorUserId,
        jobId: ctx.jobId ?? null,
        action: "INVARIANT_VIOLATION",
        entity: ctx.entity ?? "QaRework",
        entityId: ctx.entityId ?? ctx.jobId ?? "unknown",
        after: {
          kind: "INVARIANT_VIOLATION",
          code: error.code,
          message: error.message,
          details: error.details,
        } as any,
      },
    });
  } catch {
    /* audit is best-effort — never mask the invariant error */
  }
}

/**
 * Run an assertion, audit any violation, and rethrow. Use this from routes and
 * service helpers so every violation is both fatal and recorded.
 *
 *   await guardInvariant(() => assertReworkInvoiceablePayee(shape), { actorUserId, jobId });
 */
export async function guardInvariant<T>(
  assertion: () => T,
  ctx: InvariantAuditContext = {}
): Promise<T> {
  try {
    return assertion();
  } catch (error) {
    if (error instanceof ReworkInvariantError) {
      await auditInvariantViolation(error, ctx);
    }
    throw error;
  }
}

/* ── 1. invoiceable ⇔ payee ≠ original cleaner ───────────────────────────── */

export interface ReworkPayShape {
  originalCleanerId: string | null;
  /** Cleaner who will be PAID for the rework (null = nobody / same cleaner). */
  payeeCleanerId: string | null;
  /** Amount paid to the payee. */
  payAmount: number;
  /** Cleaner the deduction comes off (must be the original on the paid path). */
  deductFromCleanerId?: string | null;
}

export function assertReworkInvoiceablePayee(shape: ReworkPayShape): void {
  const amount = cents(shape.payAmount);
  const samePayee = !shape.payeeCleanerId || shape.payeeCleanerId === shape.originalCleanerId;
  const invoiceable = amount > 0;

  if (samePayee && invoiceable) {
    throw new ReworkInvariantError(
      "INVOICEABLE_PAYEE_MISMATCH",
      `A rework redone by the original cleaner must pay $0 — got $${amount.toFixed(2)}.`,
      { ...shape, amount }
    );
  }
  if (!samePayee && !invoiceable) {
    throw new ReworkInvariantError(
      "INVOICEABLE_PAYEE_MISMATCH",
      "A rework reassigned to a different cleaner must carry a positive pay amount.",
      { ...shape, amount }
    );
  }
  if (
    !samePayee &&
    shape.deductFromCleanerId !== undefined &&
    shape.deductFromCleanerId !== shape.originalCleanerId
  ) {
    throw new ReworkInvariantError(
      "INVOICEABLE_PAYEE_MISMATCH",
      "A reassigned rework must deduct from the ORIGINAL cleaner.",
      { ...shape, amount }
    );
  }
}

/* ── 2. deduction magnitude === payee payment ────────────────────────────── */

export function assertDeductionMatchesPayment(input: {
  payAmount: number;
  /** Signed adjustment amount posted against the original cleaner (negative). */
  deductionAmount: number;
}): void {
  const pay = cents(input.payAmount);
  const deduction = cents(input.deductionAmount);
  if (deduction > 0) {
    throw new ReworkInvariantError(
      "DEDUCTION_PAYMENT_MISMATCH",
      `The rework deduction must be negative — got ${deduction}.`,
      { pay, deduction }
    );
  }
  if (cents(-deduction) !== pay) {
    throw new ReworkInvariantError(
      "DEDUCTION_PAYMENT_MISMATCH",
      `Rework deduction ${deduction} does not offset the payee payment ${pay}.`,
      { pay, deduction }
    );
  }
}

/* ── 3. deduction applied at most once ───────────────────────────────────── */

export function assertSingleDeduction(input: {
  /** Job.reworkDeductionApplied as read BEFORE this mutation. */
  alreadyApplied: boolean;
  /** Existing (source, sourceKey) REWORK_DEDUCTION rows found for this rework. */
  existingDeductionCount: number;
  reworkJobId?: string | null;
}): void {
  if (input.alreadyApplied) {
    throw new ReworkInvariantError(
      "DOUBLE_DEDUCTION",
      "This rework has already had its deduction applied — refusing to deduct twice.",
      { reworkJobId: input.reworkJobId ?? null }
    );
  }
  if (input.existingDeductionCount > 0) {
    throw new ReworkInvariantError(
      "DOUBLE_DEDUCTION",
      `A rework deduction already exists for this job (${input.existingDeductionCount} row(s)).`,
      { reworkJobId: input.reworkJobId ?? null, existingDeductionCount: input.existingDeductionCount }
    );
  }
}

/* ── 4. every adjustment carries source + sourceKey ──────────────────────── */

export interface AdjustmentProvenanceShape {
  source?: string | null;
  sourceKey?: string | null;
  title?: string | null;
}

export function assertAdjustmentProvenance(adjustment: AdjustmentProvenanceShape): void {
  const source = typeof adjustment.source === "string" ? adjustment.source.trim() : "";
  const sourceKey = typeof adjustment.sourceKey === "string" ? adjustment.sourceKey.trim() : "";
  if (!source || !sourceKey) {
    throw new ReworkInvariantError(
      "MISSING_ADJUSTMENT_PROVENANCE",
      "Every rework pay adjustment must carry both `source` and `sourceKey`.",
      { source: adjustment.source ?? null, sourceKey: adjustment.sourceKey ?? null }
    );
  }
}

/* ── 5. nothing enters payroll while PENDING ─────────────────────────────── */

export interface PayrollGateShape {
  status: string;
  approvedAmount?: number | null;
  includedInPayrollRunId?: string | null;
}

export function assertPendingNotInPayroll(adjustment: PayrollGateShape): void {
  if (adjustment.status !== "PENDING") return;
  if (adjustment.includedInPayrollRunId) {
    throw new ReworkInvariantError(
      "PENDING_IN_PAYROLL",
      "A PENDING adjustment can never be stamped with a payroll run.",
      { ...adjustment }
    );
  }
  if (adjustment.approvedAmount != null) {
    throw new ReworkInvariantError(
      "PENDING_IN_PAYROLL",
      "A PENDING adjustment must not carry an approved amount.",
      { ...adjustment }
    );
  }
}

/* ── 6. QA self-rework minutes within the on-site window ─────────────────── */

/** Grace on top of the measured on-site window (write-up, travel, timer lag). */
export const SELF_REWORK_MINUTES_TOLERANCE = 15;
/** Hard ceiling when no on-site window was recorded at all. */
export const SELF_REWORK_MINUTES_HARD_CAP = 240;

export function assertSelfReworkMinutes(input: {
  minutes: number;
  /** Inspector's measured on-site minutes for the visit (null when unmeasured). */
  onSiteMinutes: number | null | undefined;
  toleranceMinutes?: number;
}): void {
  const minutes = Number(input.minutes);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new ReworkInvariantError(
      "SELF_REWORK_MINUTES_OUT_OF_BOUNDS",
      `Self-rework minutes must be a non-negative number — got ${input.minutes}.`,
      { minutes: input.minutes }
    );
  }
  const tolerance = input.toleranceMinutes ?? SELF_REWORK_MINUTES_TOLERANCE;
  const onSite =
    input.onSiteMinutes == null || !Number.isFinite(Number(input.onSiteMinutes))
      ? null
      : Math.max(0, Number(input.onSiteMinutes));
  const ceiling = onSite == null ? SELF_REWORK_MINUTES_HARD_CAP : onSite + tolerance;
  if (minutes > ceiling) {
    throw new ReworkInvariantError(
      "SELF_REWORK_MINUTES_OUT_OF_BOUNDS",
      `Self-rework claim of ${minutes} min exceeds the on-site window (${
        onSite == null ? "unmeasured" : `${onSite} min`
      } + ${onSite == null ? SELF_REWORK_MINUTES_HARD_CAP : tolerance} min allowance).`,
      { minutes, onSiteMinutes: onSite, ceiling }
    );
  }
}

/* ── composite: the different-cleaner path, checked end to end ───────────── */

export function assertReassignedReworkMoney(input: {
  originalCleanerId: string | null;
  payeeCleanerId: string | null;
  payAmount: number;
  deductFromCleanerId?: string | null;
  deductionAmount: number;
  alreadyApplied: boolean;
  existingDeductionCount: number;
  adjustment: AdjustmentProvenanceShape & PayrollGateShape;
  reworkJobId?: string | null;
}): void {
  assertReworkInvoiceablePayee(input);
  assertDeductionMatchesPayment({ payAmount: input.payAmount, deductionAmount: input.deductionAmount });
  assertSingleDeduction({
    alreadyApplied: input.alreadyApplied,
    existingDeductionCount: input.existingDeductionCount,
    reworkJobId: input.reworkJobId,
  });
  assertAdjustmentProvenance(input.adjustment);
  assertPendingNotInPayroll(input.adjustment);
}
