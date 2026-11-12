/**
 * Cleaner pay versus client charge on a pay request (owner rule 2026-11-13):
 *
 *   "When cleaners request money we will send it to clients as needed with a
 *    different rate, and once the client approved, cleaners only get paid
 *    whatever they requested only, not the full approved amount."
 *
 * A pay request (`CleanerPayAdjustment`) carries TWO different amounts once
 * the office sends it to the client:
 *
 *   - the CLEANER PAY: what the cleaner asked for (`requestedAmount`) and, once
 *     decided, what they are paid (`approvedAmount`). Payroll and cleaner
 *     invoices read only these columns.
 *   - the CLIENT CHARGE: what the client was asked to approve, stored on the
 *     linked client approval record (`amount`, or `counterAmount` while the
 *     client's counter-offer is open). It is what the client is charged and is
 *     never copied into the cleaner pay.
 *
 * Plain module (no "use client", no server-only, no I/O): the API routes, the
 * bulk planner and the approval screens share these rules, so a server
 * component may import from it too.
 */

/** The fields of a pay-request row the cleaner pay rules read. */
export type CleanerPayRow = {
  requestedAmount?: number | null;
  /** Some list responses repeat the requested amount under this name. */
  cleanerRequestedAmount?: number | null;
};

/** The fields of a linked client approval the client charge view reads. */
export type ClientChargeSource = {
  status?: string | null;
  amount?: number | null;
  counterAmount?: number | null;
};

export type ClientChargeKind = "AWAITING" | "APPROVED" | "COUNTERED" | "DECLINED" | "CLOSED";

/** The client charge, ready to show read-only beside the cleaner pay field. */
export type ClientChargeView = {
  kind: ClientChargeKind;
  /** Null when the stored amount is missing or unreadable; never shown as $0.00. */
  amount: number | null;
  label: string;
};

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cents(value: number): number {
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function dollars(amount: number | null): string {
  return amount === null ? "amount unknown" : `$${cents(amount).toFixed(2)}`;
}

/**
 * The amount the cleaner asked for. Null when it is missing or unreadable, so a
 * screen shows "no amount" instead of inventing $0.00.
 */
export function cleanerRequestedAmount(row: CleanerPayRow): number | null {
  return finiteOrNull(row.requestedAmount) ?? finiteOrNull(row.cleanerRequestedAmount);
}

/**
 * The default for every "approve amount" field of a cleaner pay request:
 * always the cleaner's requested amount — before and after the client's
 * approval, after a counter-offer and after a reload. Formatted for an input;
 * empty when the requested amount is unknown.
 */
export function cleanerPayFieldDefault(row: CleanerPayRow): string {
  const amount = cleanerRequestedAmount(row);
  return amount === null ? "" : cents(amount).toFixed(2);
}

/** The client charge for display, or null when the request was never sent to the client. */
export function clientChargeView(approval: ClientChargeSource | null | undefined): ClientChargeView | null {
  if (!approval) return null;
  const status = String(approval.status ?? "");
  if (status === "COUNTERED") {
    const amount = finiteOrNull(approval.counterAmount);
    return { kind: "COUNTERED", amount, label: `Client counter-offer: ${dollars(amount)}` };
  }
  const amount = finiteOrNull(approval.amount);
  if (status === "APPROVED") return { kind: "APPROVED", amount, label: `Client charge approved: ${dollars(amount)}` };
  if (status === "PENDING") return { kind: "AWAITING", amount, label: `Client charge awaiting approval: ${dollars(amount)}` };
  if (status === "DECLINED") return { kind: "DECLINED", amount, label: `Client declined the charge of ${dollars(amount)}` };
  return { kind: "CLOSED", amount, label: `Client charge ${status.toLowerCase() || "closed"}: ${dollars(amount)}` };
}

/** Body fields a caller sends to pay a cleaner more than they asked for. */
export type AboveRequestOverride = {
  overrideAboveRequest?: boolean;
  overrideReason?: string | null;
};

export type CleanerPayAmountInput = AboveRequestOverride & {
  /** What the cleaner asked for (signed; a deduction is negative). */
  requestedAmount: number | null | undefined;
  /** The amount the caller sent, or undefined to pay the requested amount. */
  proposedAmount: number | null | undefined;
  /** The caller holds ADMIN in a real (not impersonated) session. */
  callerIsAdministrator: boolean;
};

export type CleanerPayAmountDecision =
  | {
      ok: true;
      /** The amount to store as `approvedAmount`, rounded to whole cents. */
      amount: number;
      /** True when an administrator override paid more than was requested. */
      aboveRequest: boolean;
      overrideReason: string | null;
    }
  | { ok: false; status: 400 | 403; code: "REQUESTED_AMOUNT_UNKNOWN" | "ABOVE_REQUEST" | "OVERRIDE_REASON_REQUIRED"; error: string };

/**
 * THE server rule for the amount paid on a cleaner pay request.
 *
 * - No amount sent: the cleaner's requested amount.
 * - At or below the requested amount: allowed, as before.
 * - Above the requested amount: refused, unless the caller is an
 *   administrator, sends `overrideAboveRequest: true` and a reason. The caller
 *   audits the override with the actor, both amounts and the reason.
 *
 * The client-approved amount plays no part: it is the client charge.
 */
export function decideCleanerPayAmount(input: CleanerPayAmountInput): CleanerPayAmountDecision {
  const requested = finiteOrNull(input.requestedAmount);
  const proposed = finiteOrNull(input.proposedAmount);
  if (proposed === null) {
    if (requested === null) {
      return { ok: false, status: 400, code: "REQUESTED_AMOUNT_UNKNOWN", error: "The cleaner's requested amount is missing, so the pay amount must be entered." };
    }
    return { ok: true, amount: cents(requested), aboveRequest: false, overrideReason: null };
  }
  const amount = cents(proposed);
  if (requested !== null && amount <= cents(requested)) {
    return { ok: true, amount, aboveRequest: false, overrideReason: null };
  }
  const requestedText = requested === null ? "an unknown amount" : dollars(requested);
  if (!input.overrideAboveRequest || !input.callerIsAdministrator) {
    return {
      ok: false,
      status: 403,
      code: "ABOVE_REQUEST",
      error: `The cleaner asked for ${requestedText}. Paying ${dollars(amount)} is more than they requested; only an administrator can pay more, with an override and a reason. The client charge does not change the cleaner's pay.`,
    };
  }
  const reason = input.overrideReason?.trim() ?? "";
  if (!reason) {
    return { ok: false, status: 400, code: "OVERRIDE_REASON_REQUIRED", error: "Say why the cleaner is paid more than they requested." };
  }
  return { ok: true, amount, aboveRequest: true, overrideReason: reason.slice(0, 2000) };
}

/** The fields the "paid above request" review reads. */
export type PaidAboveRequestRow = {
  status: string;
  requestedAmount: number | null;
  approvedAmount: number | null;
  includedInPayrollRunId?: string | null;
  includedInCleanerInvoiceId?: string | null;
};

/**
 * An approved, not yet settled pay request whose approved cleaner pay is above
 * what the cleaner requested — the rows the owner reviews. Read only: existing
 * approved or paid records are never rewritten.
 */
export function isPaidAboveRequest(row: PaidAboveRequestRow): boolean {
  if (row.status !== "APPROVED") return false;
  if (row.includedInPayrollRunId || row.includedInCleanerInvoiceId) return false;
  const requested = finiteOrNull(row.requestedAmount);
  const approved = finiteOrNull(row.approvedAmount);
  if (requested === null || approved === null) return false;
  return cents(approved) > cents(requested);
}
