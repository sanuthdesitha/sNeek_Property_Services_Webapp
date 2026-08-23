/**
 * WHAT AN INVOICE IS CALLED.
 *
 * Until now a client invoice was named `INV-<yyyyMMdd>-<6 random hex>` and a
 * cleaner's invoice was not named at all. Both are problems, and they are
 * different problems.
 *
 * RANDOM IS NOT A NUMBER. An accountant asked for "invoice 41" cannot find it,
 * cannot tell whether 40 and 42 exist, and cannot show an auditor that nothing
 * was quietly removed from the middle. A gap in a sequence is information; a
 * gap between two random strings is nothing at all. It also collides: six hex
 * characters against a UNIQUE column with no retry throws a P2002 in the middle
 * of generating an invoice.
 *
 * THE TWO RAILS NUMBER SEPARATELY. Money out and money in are different
 * documents sent to different people, and interleaving them would produce a
 * client invoice 7 beside a cleaner invoice 8 with nothing in common. Each
 * sequence keeps its own prefix and its own counter.
 *
 * THE OWNER SETS WHERE IT STARTS. This business issued invoices before this
 * software existed, so the sequence has to be told what the last real number
 * was and carry on from there — not restart at 1 and re-issue a number that has
 * already been sent to somebody.
 *
 * PURE — no database. The atomic increment lives in ./invoice-sequence, which
 * is the only part that needs a transaction.
 */

export type InvoiceSequenceKey = "CLIENT" | "CLEANER";

export interface InvoiceSequenceShape {
  prefix: string;
  /** The last number ISSUED. The next one issued is this plus one. */
  lastNumber: number;
  /** Zero-padding width, so text sorting matches numeric order. */
  padding: number;
}

export const DEFAULT_SEQUENCES: Record<InvoiceSequenceKey, InvoiceSequenceShape> = {
  CLIENT: { prefix: "INV-", lastNumber: 0, padding: 4 },
  // A distinct prefix so a payee's own invoice can never be mistaken for one we
  // sent a client — they go by email to different people and get filed in
  // different places.
  CLEANER: { prefix: "PAY-", lastNumber: 0, padding: 4 },
};

/** Below this, padding stops being useful; above it, the numbers stop being readable. */
const MIN_PADDING = 1;
const MAX_PADDING = 10;

/**
 * Render one number.
 *
 * Padding is a MINIMUM, never a truncation: once a sequence passes its padded
 * width the number simply gets longer. Wrapping or trimming would re-issue a
 * number that has already been sent.
 */
export function formatInvoiceNumber(sequence: InvoiceSequenceShape, value: number): string {
  const padding = Math.min(MAX_PADDING, Math.max(MIN_PADDING, Math.trunc(sequence.padding) || 1));
  const safe = Math.max(0, Math.trunc(value));
  return `${sequence.prefix}${String(safe).padStart(padding, "0")}`;
}

/** What the NEXT invoice on this sequence will be called, without issuing it. */
export function previewNextInvoiceNumber(sequence: InvoiceSequenceShape): string {
  return formatInvoiceNumber(sequence, Math.max(0, Math.trunc(sequence.lastNumber)) + 1);
}

/**
 * Clean up what an admin typed into the sequence settings.
 *
 * A NEGATIVE OR FRACTIONAL "last number" IS REFUSED, not rounded. Silently
 * turning 41.7 into 41, or -5 into 0, would set the counter somewhere the
 * person did not choose, and the first they would hear of it is an invoice
 * carrying a number a client has already paid against.
 */
export function normaliseSequenceInput(input: {
  prefix?: unknown;
  lastNumber?: unknown;
  padding?: unknown;
}): { ok: true; value: InvoiceSequenceShape } | { ok: false; error: string } {
  const prefix = typeof input.prefix === "string" ? input.prefix.trim() : "";
  if (prefix.length > 12) {
    return { ok: false, error: "Keep the prefix to 12 characters or fewer." };
  }
  // Anything that would need escaping in a filename or a CSV cell: these
  // numbers end up in PDF names and in the Xero export.
  if (/[\\/:*?"<>|,\r\n]/.test(prefix)) {
    return { ok: false, error: 'The prefix cannot contain , / \\ : * ? " < > or |.' };
  }

  // null and "" both coerce to 0 through Number(), so an absent or blank field
  // would quietly RESET the counter and re-issue every number from 1. The value
  // has to actually be there before it is worth reading as a number.
  const rawLast = input.lastNumber;
  const looksNumeric =
    typeof rawLast === "number" || (typeof rawLast === "string" && rawLast.trim() !== "");
  const lastNumber = looksNumeric ? Number(rawLast) : Number.NaN;
  if (!Number.isInteger(lastNumber) || lastNumber < 0) {
    return { ok: false, error: "The last invoice number must be a whole number, zero or more." };
  }
  if (lastNumber > 99_999_999) {
    return { ok: false, error: "That number is too large." };
  }

  const paddingRaw =
    input.padding === undefined || input.padding === null ? 4 : Number(input.padding);
  if (!Number.isInteger(paddingRaw) || paddingRaw < MIN_PADDING || paddingRaw > MAX_PADDING) {
    return {
      ok: false,
      error: `Padding must be a whole number between ${MIN_PADDING} and ${MAX_PADDING}.`,
    };
  }

  return { ok: true, value: { prefix, lastNumber, padding: paddingRaw } };
}

/**
 * Read a number back out of a formatted string.
 *
 * Answers "is this sequence already past the number the admin is trying to set
 * it to?" — moving a counter BACKWARDS re-issues numbers, so the caller needs to
 * be able to see that before it happens.
 *
 * Returns null for anything that is not this sequence's own format, including
 * the legacy `INV-20260823-A1B2C3` numbers, which deliberately do not parse:
 * they were never part of a sequence and must not be read as one.
 */
export function parseInvoiceNumber(sequence: InvoiceSequenceShape, value: string): number | null {
  if (!sequence.prefix || !value.startsWith(sequence.prefix)) return null;
  const digits = value.slice(sequence.prefix.length);
  if (!/^\d+$/.test(digits)) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * The name used when the sequence cannot be reached at all.
 *
 * This is the OLD scheme, kept for exactly one reason: an environment whose
 * migration has not run yet must still be able to issue an invoice. Losing the
 * sequence is a numbering problem; failing to invoice is a cash-flow problem,
 * and only one of those can be repaired afterwards.
 *
 * Deliberately not parseable as a sequence number, so a fallback invoice can
 * never be mistaken for one and can never move the counter.
 */
export function legacyFallbackNumber(now: Date, random: string): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `INV-${yyyy}${mm}${dd}-${random.slice(0, 6).toUpperCase()}`;
}
