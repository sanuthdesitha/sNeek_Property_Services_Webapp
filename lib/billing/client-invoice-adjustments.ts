/**
 * Discount lines and credit-note limits: the pure rules the invoice PATCH, the
 * credit-note service and the editor share. Amounts are dollars stored as
 * numbers rounded to cents, like every other invoice amount in this codebase.
 *
 * Free of server imports: safe for client components and tests.
 */

export const DISCOUNT_CATEGORY = "DISCOUNT";

export const DISCOUNT_BELOW_ZERO_REFUSAL =
  "A discount cannot take the invoice total below zero. Lower the discount or remove it.";
export const DISCOUNT_AMOUNT_LOCKED_REFUSAL =
  "A discount's amount cannot be edited. Remove it and add the discount again.";
export const DISCOUNT_ON_CREDIT_NOTE_REFUSAL = "A credit note cannot carry a discount. Reduce its lines instead.";

type AmountLine = { category: string; lineTotal: number };

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isDiscountLine(line: { category: string }): boolean {
  return line.category === DISCOUNT_CATEGORY;
}

/** What a percentage discount is a percentage of: every line that is not itself a discount. */
export function discountBase(lines: readonly AmountLine[]): number {
  return cents(lines.filter((line) => !isDiscountLine(line)).reduce((sum, line) => sum + Number(line.lineTotal), 0));
}

export type DiscountInput = { amount?: number | null; percent?: number | null };
export type DiscountResult =
  | { ok: true; amount: number; percent: number | null }
  | { ok: false; error: string };

/**
 * The positive amount a discount takes off, from either a dollar amount or a
 * percentage of the current subtotal. The stored line is the negative of it.
 */
export function resolveDiscount(input: DiscountInput, lines: readonly AmountLine[]): DiscountResult {
  const hasAmount = typeof input.amount === "number";
  const hasPercent = typeof input.percent === "number";
  if (hasAmount === hasPercent) return { ok: false, error: "Enter the discount as an amount or as a percentage, not both." };
  if (hasPercent) {
    const percent = Number(input.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return { ok: false, error: "A percentage discount must be more than 0 and at most 100." };
    }
    const amount = cents((discountBase(lines) * percent) / 100);
    if (amount <= 0) return { ok: false, error: "There is nothing on this invoice to discount yet." };
    return { ok: true, amount, percent };
  }
  const amount = cents(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "A discount must be more than zero." };
  return { ok: true, amount, percent: null };
}

/** True when an INVOICE's taxable lines add up to less than zero (a discount went too far). */
export function invoiceGoesBelowZero(lines: readonly AmountLine[], kind: string | null | undefined): boolean {
  if (kind === "CREDIT_NOTE") return false;
  const taxable = lines
    .filter((line) => line.category !== "SHOPPING_DISBURSEMENT")
    .reduce((sum, line) => sum + Number(line.lineTotal), 0);
  return taxable < -0.005;
}

/* ── Credit notes ─────────────────────────────────────────────────────── */

export const CREDIT_NOTE_SOURCE_STATUSES: ReadonlySet<string> = new Set(["SENT", "PART_PAID", "PAID"]);

export const LIVE_CREDIT_NOTES_REFUSAL =
  "This invoice has credit notes that are not void. Void them first, so no credit is left pointing at a cancelled invoice.";

export const CREDIT_NOTE_PAYMENT_REFUSAL =
  "A credit note is not paid. Once approved or sent it reduces what is owed on the invoice it credits.";

/** Why this invoice cannot be credited, or null when it can. */
export function creditNoteSourceRefusal(invoice: { kind: string; status: string }): string | null {
  if (invoice.kind === "CREDIT_NOTE") return "A credit note cannot itself be credited.";
  if (invoice.status === "VOID") return "A void invoice cannot be credited.";
  if (invoice.status === "DRAFT" || invoice.status === "APPROVED") {
    return "This invoice has not been sent. Edit it directly, or reverse it to draft.";
  }
  if (!CREDIT_NOTE_SOURCE_STATUSES.has(invoice.status)) return "This invoice cannot be credited.";
  return null;
}

/** The most that may still be credited: the original total less credits already issued. */
export function creditableRemaining(originalTotal: number, issuedCredits: number): number {
  return Math.max(0, cents(Number(originalTotal) - Number(issuedCredits)));
}

/**
 * Why a credit note's total is not acceptable, or null. `total` is the credit
 * note's own (negative) total. `previousTotal`, when given, lets an edit that
 * only reduces an over-limit draft through, so a pre-filled draft can always be
 * brought within the limit.
 */
export function creditNoteTotalRefusal(input: {
  total: number;
  remaining: number;
  originalNumber: string;
  previousTotal?: number;
  requireCredit?: boolean;
}): string | null {
  const magnitude = -Number(input.total);
  if (magnitude < -0.005) return "A credit note cannot add a charge. Its total must be zero or less.";
  if (input.requireCredit && magnitude <= 0.005) return "This credit note credits nothing. Keep at least one credit line.";
  if (magnitude > input.remaining + 0.005) {
    const shrinking = input.previousTotal !== undefined && magnitude < -Number(input.previousTotal) - 0.005;
    if (!shrinking) {
      return `This credit note would credit more than ${input.originalNumber} has left to credit ($${input.remaining.toFixed(2)}).`;
    }
  }
  return null;
}

/** A credit-note line copied from the original: same description and quantity, negated price. */
export function negatedLine<T extends { unitPrice: number; lineTotal: number }>(line: T): T {
  // 0 - x rather than -x, so a zero-priced line stays 0 and never prints as -0.
  return { ...line, unitPrice: 0 - Number(line.unitPrice), lineTotal: 0 - Number(line.lineTotal) };
}
