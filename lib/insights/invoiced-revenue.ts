/**
 * Insights revenue from invoices (owner decision 2026-11-11, second set item 5).
 *
 * A clean's revenue is what it was INVOICED for, when it is invoiced under the
 * one rule (`lib/invoicing/invoiced-job-rule.ts`: a line on a live invoice —
 * kind INVOICE, not VOID, not fully credited; drafts count, as they do for
 * "Ready to bill"). That is the fixed record: changing the rate card never
 * moves it. Only a clean that is NOT invoiced falls back to its scheduled
 * charge (`computeClientCharge`), shown separately as "Not yet invoiced (at
 * current rates)".
 *
 * Amounts are EX GST on both sides: a line's `lineTotal` is quantity × unit
 * price before GST (GST is added at invoice level), the scheduled charge is the
 * same ex-GST rate the generator prices a line at, and cleaner cost carries no
 * GST, so margin compares like with like.
 *
 * Partial credit notes: credit-note lines carry no job, so an approved/sent
 * credit note against an invoice reduces each of that invoice's job lines in
 * proportion — the credited share is the credit notes' ex-GST subtotal over the
 * invoice's ex-GST subtotal (never more than all of it). Invoice-level discount
 * lines are not spread over jobs.
 *
 * Pure: the loader passes already-read rows.
 */
import { roundCents } from "@/lib/finance/job-money";

export type InvoicedLineRow = {
  jobId: string | null;
  lineTotal: number;
  invoice: {
    id: string;
    subtotal: number;
    /** Approved or sent credit notes against this invoice (their subtotals are negative). */
    creditNotes: ReadonlyArray<{ subtotal: number }>;
  };
};

/** The share of an invoice still standing after its credit notes, 0..1. */
export function remainingShare(invoice: InvoicedLineRow["invoice"]): number {
  const subtotal = Number(invoice.subtotal);
  if (!(subtotal > 0)) return 1;
  const credited = invoice.creditNotes.reduce((total, note) => total + Math.abs(Number(note.subtotal ?? 0)), 0);
  if (!(credited > 0)) return 1;
  return Math.max(0, 1 - credited / subtotal);
}

/** Net invoiced amount (ex GST) per job, from lines on live invoices. */
export function invoicedRevenueByJob(lines: readonly InvoicedLineRow[]): Map<string, number> {
  const byJob = new Map<string, number>();
  for (const line of lines) {
    if (!line.jobId) continue;
    const net = Number(line.lineTotal) * remainingShare(line.invoice);
    byJob.set(line.jobId, (byJob.get(line.jobId) ?? 0) + net);
  }
  for (const [jobId, amount] of byJob) byJob.set(jobId, roundCents(amount));
  return byJob;
}
