import { db } from "@/lib/db";

/** Issued receivables only; drafts/approved-but-unsent are not money chased. */
export const OUTSTANDING_INVOICE_STATUSES = ["SENT", "PART_PAID"] as const;
/** What is still owed on one invoice: its total less payments, never below zero. */
export function invoiceAmountOwing(row: { totalAmount: number | null; paidAmount: number | null }): number {
  return Math.max(0, Number(row.totalAmount ?? 0) - Number(row.paidAmount ?? 0));
}
export function summarizeReceivables(rows: Array<{ totalAmount: number | null; paidAmount: number | null }>) {
  return { outstandingCount: rows.length, outstandingAud: Number(rows.reduce((sum, row) =>
    sum + invoiceAmountOwing(row), 0).toFixed(2)) };
}
export async function getOutstandingReceivables() {
  const rows = await db.clientInvoice.findMany({
    where: { status: { in: [...OUTSTANDING_INVOICE_STATUSES] } },
    select: { totalAmount: true, paidAmount: true },
  });
  return summarizeReceivables(rows);
}
