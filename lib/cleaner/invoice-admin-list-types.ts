/**
 * Shapes shared by the paged cleaner-invoice list route and the admin screen.
 * No server imports.
 */
import type { CleanerInvoiceStatus } from "./invoice-transitions";

export const CLEANER_INVOICE_STATUS_FILTERS = [
  "needs-action",
  "SUBMITTED",
  "APPROVED",
  "CHANGES_REQUESTED",
  "XERO_PUSHED",
  "PAID_CLAIMED",
  "PAID",
  "VOID",
  "all",
] as const;
export type CleanerInvoiceStatusFilter = (typeof CLEANER_INVOICE_STATUS_FILTERS)[number];

/** Real columns only. The payee name is not a column on the submission, so it does not sort. */
export const CLEANER_INVOICE_SORTS = ["number", "period", "submitted", "jobs", "hours", "total", "status"] as const;
export type CleanerInvoiceSort = (typeof CLEANER_INVOICE_SORTS)[number];

export type CleanerInvoiceProof = { key: string; url: string };

/** One row: the old response's fields, unchanged, so existing callers keep working. */
export type CleanerInvoiceRow = {
  id: string;
  invoiceNumber: string | null;
  cleanerId: string;
  cleanerName: string;
  cleanerRole: string | null;
  periodStart: string;
  periodEnd: string;
  hours: number;
  totalAmount: number;
  jobCount: number;
  status: CleanerInvoiceStatus;
  xeroBillId: string | null;
  xeroExportedAt: string | null;
  lineData: unknown;
  createdAt: string;
  paidAmount: number | null;
  paidBankAccount: string | null;
  paidNote: string | null;
  paymentMethod: string | null;
  paidDate: string | null;
  paidAt: string | null;
  paidClaimedAt: string | null;
  paidClaimedNote: string | null;
  paidClaimedProofUrls: CleanerInvoiceProof[];
  changesRequestedAt: string | null;
  changesRequestedNote: string | null;
};

export type CleanerInvoiceCounts = {
  all: number;
  needsAction: number;
  byStatus: Record<string, number>;
};

export type CleanerInvoiceListPayload = {
  rows: CleanerInvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  sort: CleanerInvoiceSort;
  dir: "asc" | "desc";
  counts: CleanerInvoiceCounts;
};

/** The four stat cards: stored totals over every invoice, not one page. */
export type CleanerInvoiceStats = {
  awaitingAction: number;
  /** Total of SUBMITTED and APPROVED invoices (asked for, not yet in Xero or paid). */
  awaitingValue: number;
  inXero: number;
  paid: number;
};

export type CleanerPayeeOption = { id: string; name: string; role: string | null };

export const CLEANER_INVOICE_BULK_ACTIONS = ["approve", "xero-push"] as const;
export type CleanerInvoiceBulkAction = (typeof CLEANER_INVOICE_BULK_ACTIONS)[number];
export const CLEANER_INVOICE_BULK_MAX_IDS = 50;

export type CleanerBulkResult = {
  id: string;
  invoiceNumber: string | null;
  outcome: "done" | "refused" | "unchanged";
  reason?: string;
};
export type CleanerBulkResponse = {
  action: CleanerInvoiceBulkAction;
  results: CleanerBulkResult[];
  summary: { done: number; refused: number; unchanged: number };
};
