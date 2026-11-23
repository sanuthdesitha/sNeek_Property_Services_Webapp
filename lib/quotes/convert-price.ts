/**
 * The agreed client price a converted quote gives its job (2026-11-23).
 *
 * Before: convert-to-job created the job with no price, so a one-off job won
 * from a quote was billed from the property's rate or the price list, or, with
 * neither, the invoice generator refused the client ("Missing client rates").
 * The amount the client accepted was on the quote all along.
 *
 * Rule: a ONE-OFF quote (no recurring frequency) with a positive subtotal sets
 * the job's fixed client price to that subtotal (ex GST; the invoice applies GST
 * as it does for every line) and notes where it came from. A recurring quote
 * sets nothing: its subtotal may cover a whole plan rather than one visit, so
 * the visit stays on the client's rate and is shown as needing a price on New
 * invoice when there is none. A zero or unreadable subtotal is never turned
 * into a $0 price. Plain module.
 */
import { formatQuoteReference } from "./quote-reference";

const RECURRING = new Set(["weekly", "fortnightly", "monthly"]);

export type QuoteAgreedPrice = { fixedPrice: number; invoiceNote: string };

export function agreedJobPriceFromQuote(quote: { frequency: string | null; subtotal: number | null; quoteNumber: number | null }): QuoteAgreedPrice | null {
  if (quote.frequency && RECURRING.has(quote.frequency)) return null;
  const subtotal = Number(quote.subtotal);
  if (quote.subtotal === null || !Number.isFinite(subtotal) || subtotal <= 0) return null;
  const reference = formatQuoteReference(quote.quoteNumber);
  return {
    fixedPrice: Math.round(subtotal * 100) / 100,
    invoiceNote: reference ? `Agreed price from quote ${reference}` : "Agreed price from the accepted quote",
  };
}
