/**
 * What a client invoice or credit note says in Xero, as pure functions so the
 * push payload can be tested without credentials.
 */

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The Xero reference. Before Money step (c) it was "Service period <start> –
 * <end>" (or nothing). Now the client's PO / reference comes first, because it
 * is what the client's accounts team matches on, followed by the service
 * period; a credit note names the invoice it credits. Xero limits a reference
 * to 255 characters. The reference is not part of the idempotency key, which
 * stays "client-invoice-<id>".
 */
export function xeroInvoiceReference(input: {
  clientReference: string | null | undefined;
  periodStart: Date | null;
  periodEnd: Date | null;
  creditsInvoiceNumber?: string | null;
}): string | undefined {
  const parts: string[] = [];
  const po = input.clientReference?.trim();
  if (po) parts.push(po);
  if (input.creditsInvoiceNumber) parts.push(`Credit for ${input.creditsInvoiceNumber}`);
  else if (input.periodStart && input.periodEnd) {
    parts.push(`Service period ${isoDay(input.periodStart)} – ${isoDay(input.periodEnd)}`);
  }
  const reference = parts.join(" · ");
  return reference ? reference.slice(0, 255) : undefined;
}

type XeroLine = { description: string; quantity: number; unitAmount: number };

/**
 * A credit-note line for Xero. Our credit-note lines are stored negative; a
 * Xero ACCRECCREDIT line is positive, so the amount is negated. A reversed
 * discount (positive on our credit note) becomes a negative Xero line.
 */
export function xeroCreditNoteLineItem<T extends XeroLine>(line: T): T {
  return { ...line, unitAmount: 0 - Number(line.unitAmount) };
}
