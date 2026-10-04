import { db } from "@/lib/db";

/** Issued receivables only; drafts/approved-but-unsent are not money chased. */
export const OUTSTANDING_INVOICE_STATUSES = ["SENT", "PART_PAID"] as const;
export function summarizeReceivables(rows: Array<{ totalAmount: number | null; paidAmount: number | null }>) {
  return { outstandingCount: rows.length, outstandingAud: Number(rows.reduce((sum, row) =>
    sum + Math.max(0, Number(row.totalAmount ?? 0) - Number(row.paidAmount ?? 0)), 0).toFixed(2)) };
}
export async function getOutstandingReceivables() {
  const rows = await db.clientInvoice.findMany({
    where: { status: { in: [...OUTSTANDING_INVOICE_STATUSES] } },
    select: { totalAmount: true, paidAmount: true },
  });
  return summarizeReceivables(rows);
}
