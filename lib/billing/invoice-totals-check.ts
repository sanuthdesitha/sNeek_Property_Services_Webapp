/**
 * Reconciliation fail-safe: totalAmount is DENORMALISED from the lines, and
 * several code paths recompute it. True when the stored total disagrees with
 * what the lines and GST setting produce. Detection only; never changes money.
 * (Moved from client-invoices.ts unchanged; since Wave D a draft with a
 * mismatch is not approved, client-invoice-approval-rules.ts.)
 */
import { calculateShoppingAwareInvoiceTotals } from "./shopping-client-charges";

export function invoiceTotalsMismatch(invoice: {
  lines: Parameters<typeof calculateShoppingAwareInvoiceTotals>[0];
  gstEnabled: boolean | null;
  totalAmount: number;
  kind?: string | null;
}): boolean {
  const expected = calculateShoppingAwareInvoiceTotals(invoice.lines, invoice.gstEnabled ?? true, { kind: invoice.kind });
  return Math.abs(expected.totalAmount - Number(invoice.totalAmount)) > 0.011;
}
