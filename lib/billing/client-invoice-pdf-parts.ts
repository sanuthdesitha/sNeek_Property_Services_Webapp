/**
 * Pieces of the client-invoice PDF added in Money step (c): the document title
 * (tax invoice or credit note), the client reference and credit-note link
 * lines, the note to the client, the due line, and money printed with a
 * leading minus for discount and credit lines. Pure and tested directly; the
 * page itself is assembled in client-invoices.ts.
 */
import { invoiceDueDay, printCalendarDay } from "./invoice-due";

export function escapePdfText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "$12.50", or "-$12.50" for a discount or credit (never "$-12.50"). */
export function pdfMoney(value: number): string {
  const amount = Number(value) || 0;
  const text = `$${Math.abs(amount).toFixed(2)}`;
  return amount < -0.004 ? `-${text}` : text;
}

export type PdfDocumentFacts = {
  kind?: string | null;
  createdAt: Date | string;
  clientReference?: string | null;
  clientNote?: string | null;
  creditsInvoice?: { invoiceNumber: string } | null;
};

export function isCreditNoteDocument(invoice: PdfDocumentFacts): boolean {
  return invoice.kind === "CREDIT_NOTE";
}

export function pdfDocumentTitle(invoice: PdfDocumentFacts): string {
  return isCreditNoteDocument(invoice) ? "CREDIT NOTE" : "TAX INVOICE";
}

/**
 * The due line, from the same function the invoice list uses. A credit note
 * has nothing due, so it prints none.
 */
export function pdfDueLine(
  invoice: PdfDocumentFacts,
  termsDays: number,
  timezone: string | null | undefined,
  options: { provisional?: boolean } = {},
): string | null {
  if (isCreditNoteDocument(invoice)) return null;
  const day = printCalendarDay(invoiceDueDay(invoice.createdAt, termsDays, timezone));
  // An office preview of an unsent invoice: its terms are fixed when it is
  // first sent, so the day is labelled provisional (never on a sent document).
  if (options.provisional) return `Due (provisional): ${day} · ${termsDays}-day terms, fixed when sent`;
  return `Due: ${day}`;
}

/** The admin preview labels the due day provisional while the invoice has not been sent. */
export function isProvisionalDueStatus(status: string | null | undefined): boolean {
  return status === "DRAFT" || status === "APPROVED";
}

/** Extra lines under the number: the invoice a credit note credits, and the client's reference. */
export function pdfHeaderExtrasHtml(invoice: PdfDocumentFacts): string {
  const rows: string[] = [];
  if (isCreditNoteDocument(invoice) && invoice.creditsInvoice) {
    rows.push(`Credits invoice ${escapePdfText(invoice.creditsInvoice.invoiceNumber)}`);
  }
  if (invoice.clientReference?.trim()) {
    rows.push(`Your reference: ${escapePdfText(invoice.clientReference.trim())}`);
  }
  return rows.map((row) => `<p style="margin:4px 0 0;font-size:13px;color:#374151;">${row}</p>`).join("");
}

/** The note to the client, kept with its line breaks. Empty when there is none. */
export function pdfClientNoteHtml(invoice: PdfDocumentFacts): string {
  const note = invoice.clientNote?.trim();
  if (!note) return "";
  const body = escapePdfText(note).replace(/\r?\n/g, "<br />");
  return `
        <div style="margin-top:24px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:6px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:600;text-transform:uppercase;color:#6b7280;letter-spacing:0.05em;">Note</p>
          <p style="margin:0;font-size:13px;color:#111827;">${body}</p>
        </div>
      `;
}
