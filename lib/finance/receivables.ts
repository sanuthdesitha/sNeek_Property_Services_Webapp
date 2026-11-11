import { db } from "@/lib/db";

/** Issued receivables only; drafts/approved-but-unsent are not money chased. */
export const OUTSTANDING_INVOICE_STATUSES = ["SENT", "PART_PAID"] as const;

/**
 * Credit note statuses that reduce what is owed on the invoice they credit. A
 * draft credit note is still being worked out and a void one is cancelled, so
 * neither changes the balance.
 */
export const CREDIT_REDUCING_STATUSES = ["APPROVED", "SENT"] as const;

export type CreditNoteFacts = { status: string; totalAmount: number | null };

/**
 * The amount credited against one invoice, as a positive figure. Credit notes
 * store negative totals, so each counting note contributes its magnitude.
 */
export function creditedAmountOf(creditNotes: readonly CreditNoteFacts[] | null | undefined): number {
  const counted = (creditNotes ?? []).filter((note) =>
    (CREDIT_REDUCING_STATUSES as readonly string[]).includes(note.status),
  );
  const total = counted.reduce((sum, note) => sum + Math.abs(Number(note.totalAmount ?? 0)), 0);
  return Number(total.toFixed(2));
}

export type OwingFacts = {
  totalAmount: number | null;
  paidAmount: number | null;
  /** Approved or sent credit notes against this invoice (positive). */
  creditedAmount?: number | null;
};

/** What is still owed on one invoice: its total less payments and credits, never below zero. */
export function invoiceAmountOwing(row: OwingFacts): number {
  // Not rounded per invoice: summaries round the portfolio figure once.
  return Math.max(0, Number(row.totalAmount ?? 0) - Number(row.paidAmount ?? 0) - Number(row.creditedAmount ?? 0));
}

/**
 * A credited invoice nobody has paid against, whose credits cover its whole
 * total. Shown as "Fully credited" without a new status, so the transition
 * graph is unchanged: the invoice stays SENT (or PART_PAID) with nothing owing.
 */
export function isFullyCredited(row: OwingFacts): boolean {
  const credited = Number(row.creditedAmount ?? 0);
  if (credited <= 0) return false;
  if (Number(row.paidAmount ?? 0) > 0) return false;
  return credited + 0.005 >= Number(row.totalAmount ?? 0);
}

export function summarizeReceivables(rows: OwingFacts[]) {
  // A fully credited invoice is not money being chased, so it is not counted.
  const chased = rows.filter((row) => !isFullyCredited(row));
  return {
    outstandingCount: chased.length,
    outstandingAud: Number(chased.reduce((sum, row) => sum + invoiceAmountOwing(row), 0).toFixed(2)),
  };
}

/** Select for the credit notes that can reduce an invoice's balance. */
export const REDUCING_CREDIT_NOTES_SELECT = {
  where: { status: { in: [...CREDIT_REDUCING_STATUSES] } },
  select: { status: true, totalAmount: true },
} as const;

export async function getOutstandingReceivables() {
  const rows = await db.clientInvoice.findMany({
    where: { kind: "INVOICE", status: { in: [...OUTSTANDING_INVOICE_STATUSES] } },
    select: { totalAmount: true, paidAmount: true, creditNotes: REDUCING_CREDIT_NOTES_SELECT },
  });
  return summarizeReceivables(
    rows.map((row) => ({
      totalAmount: row.totalAmount,
      paidAmount: row.paidAmount,
      creditedAmount: creditedAmountOf(row.creditNotes),
    })),
  );
}

/** The approved/sent credits against one invoice, read fresh (for payment routes). */
export async function readCreditedAmount(invoiceId: string): Promise<number> {
  const notes = await db.clientInvoice.findMany({
    where: { creditsInvoiceId: invoiceId, kind: "CREDIT_NOTE", status: { in: [...CREDIT_REDUCING_STATUSES] } },
    select: { status: true, totalAmount: true },
  });
  return creditedAmountOf(notes);
}
