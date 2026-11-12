/**
 * The reference a client sees on a quote: "Q-204".
 *
 * Plain module (no "use client", no database): the admin list, the quote PDF,
 * the public quote page, the client's My quotes and Approvals all format the
 * stored `Quote.quoteNumber` through this one function, so every surface names
 * the same quote the same way.
 *
 * A missing or unusable number is never shown as "Q-0": the caller gets null
 * and says the reference is unavailable instead.
 */

export const QUOTE_REFERENCE_PREFIX = "Q-";

/** "Q-204" for a stored quote number; null when there is no valid number. */
export function formatQuoteReference(quoteNumber: number | null | undefined): string | null {
  if (typeof quoteNumber !== "number" || !Number.isSafeInteger(quoteNumber) || quoteNumber < 1) return null;
  return `${QUOTE_REFERENCE_PREFIX}${quoteNumber}`;
}

/** Text for a heading or a list cell: the reference, or a plain "no reference" label. */
export function quoteReferenceLabel(quoteNumber: number | null | undefined): string {
  return formatQuoteReference(quoteNumber) ?? "No reference";
}
