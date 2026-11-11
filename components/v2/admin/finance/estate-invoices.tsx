"use client";

/**
 * ESTATE client invoices — the "Client invoices" tab of Invoices and pay.
 *
 * The 1,698-line component this file used to be is split into
 * components/v2/admin/finance/invoices/: the paged list and filters, the row
 * actions, the bulk bar, the editor and one file per group of dialogs. The
 * requests and their rules are unchanged; see invoice-requests.ts.
 *
 * Endpoints:
 *   GET   /api/admin/invoices?paginated=1&…          → { rows, total, counts, … }
 *   GET   /api/admin/invoices?view=context|stats
 *   POST  /api/admin/invoices/bulk                   { action, ids } → per-row results
 *   GET   /api/admin/invoices/export                 text/csv
 *   GET/PATCH/DELETE /api/admin/invoices/[id], POST …/send, …/xero-push, …/reconcile
 *   POST  /api/admin/invoices/generate
 */
import { InvoiceList } from "./invoices/invoice-list";

export function EstateInvoices() {
  return <InvoiceList />;
}
