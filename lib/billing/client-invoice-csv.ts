/**
 * The client-invoice CSV export (moved out of client-invoice-list.ts in Wave D
 * unchanged, except that the Xero state column says FAILED for a failed push).
 */
import type { ClientInvoiceListRow } from "./client-invoice-list-types";

/** An amount we formatted ourselves: never a formula, even when negative. */
type CsvAmount = { amount: number };

function csvCell(value: string | number | CsvAmount | null | undefined): string {
  if (value === null || value === undefined) return "";
  // A credit note's "-50.00" is a number, not a formula, so it is not escaped.
  if (typeof value === "object") return value.amount.toFixed(2);
  let text = String(value);
  // A leading formula character would execute in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function clientInvoicesCsv(rows: ClientInvoiceListRow[]): string {
  const header = [
    "Invoice number",
    "Client",
    "Client email",
    "Status",
    "Period start",
    "Period end",
    "Created",
    "Due (from payment terms)",
    "Sent",
    "Total",
    "Paid",
    "Owing",
    "Xero state",
    "Xero invoice ID",
    "Xero check",
    "Xero check reason",
    "Kind",
    "Credits invoice",
    "Credited",
    "Client reference",
  ];
  const lines = rows.map((row) =>
    [
      row.invoiceNumber,
      row.client.name,
      row.client.email,
      row.status,
      // Stored instants, unconverted: manual and scheduled drafts store their
      // period boundaries differently, so a reformatted day could shift.
      row.periodStart ?? "",
      row.periodEnd ?? "",
      row.createdAt,
      row.dueDate,
      row.sentAt ?? "",
      { amount: row.totalAmount },
      row.paidAmount === null ? "" : { amount: row.paidAmount },
      { amount: row.amountOwing },
      row.xeroPushFailure ? "FAILED" : row.xeroState,
      row.xeroInvoiceId,
      row.xeroSync?.state ?? "",
      row.xeroSync?.reason ?? "",
      row.kind === "CREDIT_NOTE" ? "Credit note" : "Invoice",
      row.credits?.invoiceNumber ?? "",
      { amount: row.creditedAmount },
      row.clientReference,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
