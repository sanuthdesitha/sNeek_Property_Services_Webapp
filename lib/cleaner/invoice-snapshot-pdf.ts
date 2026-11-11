/**
 * The admin copy of a submitted payee invoice, as a PDF.
 *
 * Built from the submission's own snapshot (lineData: contact and the lines
 * that were billed, the stored invoice number, period and total), never from
 * today's job data: re-running the cleaner's live invoice calculation would
 * print a different document from the one accounts received (the jobs are now
 * claimed, and rates or hours may have changed since). Rendered with the
 * cleaner download's renderer (renderCleanerInvoicePdf). It shows only this
 * one submission, which the admin list already shows in full.
 */
import type { CleanerInvoiceSubmission } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";

type SnapshotLine = { description?: unknown; quantity?: unknown; unitAmount?: unknown };
type Snapshot = {
  contact?: { name?: unknown; email?: unknown; phone?: unknown; address?: unknown; abn?: unknown };
  lines?: unknown;
};

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
const sydneyDay = (date: Date) => formatInTimeZone(date, "Australia/Sydney", "d MMM yyyy");

export type SnapshotInvoiceLine = { description: string; quantity: number; unitAmount: number; amount: number };

/** The billed lines from the snapshot; a line without a readable amount is reported, not zeroed. */
export function snapshotLines(lineData: unknown): { lines: SnapshotInvoiceLine[]; unreadable: number } {
  const raw = (lineData as Snapshot | null)?.lines;
  const list = Array.isArray(raw) ? (raw as SnapshotLine[]) : [];
  const lines: SnapshotInvoiceLine[] = [];
  let unreadable = 0;
  for (const line of list) {
    const quantity = typeof line?.quantity === "number" ? line.quantity : 1;
    const unitAmount = typeof line?.unitAmount === "number" && Number.isFinite(line.unitAmount) ? line.unitAmount : null;
    if (unitAmount === null) {
      unreadable += 1;
      continue;
    }
    lines.push({ description: text(line?.description) ?? "Line", quantity, unitAmount, amount: Number((quantity * unitAmount).toFixed(2)) });
  }
  return { lines, unreadable };
}

export function buildSubmittedInvoiceHtml(submission: CleanerInvoiceSubmission, payeeName: string, companyName: string): string {
  const snapshot = (submission.lineData ?? {}) as Snapshot;
  const contact = snapshot.contact ?? {};
  const { lines, unreadable } = snapshotLines(submission.lineData);
  const from = [text(contact.name) ?? payeeName, text(contact.email), text(contact.phone), text(contact.address), text(contact.abn) ? `ABN ${text(contact.abn)}` : null]
    .filter(Boolean)
    .map((value) => `<div>${escapeHtml(value as string)}</div>`)
    .join("");
  const rows = lines
    .map((line) => `<tr><td>${escapeHtml(line.description)}</td><td class="r">${line.quantity}</td><td class="r">${money(line.unitAmount)}</td><td class="r">${money(line.amount)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(submission.invoiceNumber ?? "Invoice")}</title>
<style>body{font-family:Helvetica,Arial,sans-serif;color:#111;font-size:12px}h1{font-size:22px;margin:0 0 4px}
.meta{color:#555;margin-bottom:16px}.cols{display:flex;gap:40px;margin-bottom:18px}h2{font-size:11px;text-transform:uppercase;color:#666;margin:0 0 4px}
table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}.r{text-align:right}
.total td{font-weight:700;border-top:2px solid #111}.note{margin-top:14px;color:#555;font-size:10px}</style></head><body>
<h1>Invoice ${escapeHtml(submission.invoiceNumber ?? "(not numbered)")}</h1>
<div class="meta">Period ${sydneyDay(submission.periodStart)} – ${sydneyDay(submission.periodEnd)} · submitted ${sydneyDay(submission.createdAt)}</div>
<div class="cols"><div><h2>From</h2>${from}</div><div><h2>Bill to</h2><div>${escapeHtml(companyName)}</div></div></div>
<table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead>
<tbody>${rows || `<tr><td colspan="4">No line snapshot was stored for this submission.</td></tr>`}</tbody>
<tfoot><tr class="total"><td colspan="3">Total</td><td class="r">${money(submission.totalAmount)}</td></tr></tfoot></table>
${unreadable ? `<p class="note">${unreadable} line(s) in the snapshot had no readable amount and are not shown; the total is the stored total.</p>` : ""}
<p class="note">Office copy generated from the invoice as submitted. It is not a new invoice.</p>
</body></html>`;
}
