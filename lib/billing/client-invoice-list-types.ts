/**
 * Shapes shared by the client-invoice list route and the admin screen. Kept
 * free of server imports so client components can import them.
 */

export const CLIENT_INVOICE_STATUSES = ["DRAFT", "APPROVED", "SENT", "PART_PAID", "PAID", "VOID"] as const;
export type ClientInvoiceStatusValue = (typeof CLIENT_INVOICE_STATUSES)[number];

/** Columns the list route can sort by. Each maps to a real column. */
export const CLIENT_INVOICE_SORTS = ["number", "client", "period", "created", "sent", "total", "status", "xero"] as const;
export type ClientInvoiceSort = (typeof CLIENT_INVOICE_SORTS)[number];

/**
 * Status chips. `needs-action` = drafts to review, approved invoices not yet
 * sent, and invoices whose Xero export is pending or failed. `overdue` = sent or
 * part-paid invoices past the due date printed on their PDF.
 */
export const CLIENT_INVOICE_STATUS_FILTERS = [
  "active",
  "needs-action",
  "overdue",
  ...CLIENT_INVOICE_STATUSES,
  "all",
] as const;
export type ClientInvoiceStatusFilter = (typeof CLIENT_INVOICE_STATUS_FILTERS)[number];

/**
 * Xero state as far as the stored export metadata allows. A failed push leaves
 * the reservation PENDING, so "pending" also covers failed pushes; the two
 * cannot be told apart from the data.
 */
export const CLIENT_INVOICE_XERO_FILTERS = ["any", "none", "pushed", "pending"] as const;
export type ClientInvoiceXeroFilter = (typeof CLIENT_INVOICE_XERO_FILTERS)[number];
export type ClientInvoiceXeroState = "NONE" | "PUSHED" | "PENDING";

export type ClientInvoiceListFilters = {
  status: ClientInvoiceStatusFilter;
  clientId: string | null;
  /** Calendar day (yyyy-MM-dd) in the organisation timezone. */
  periodFrom: string | null;
  periodTo: string | null;
  xero: ClientInvoiceXeroFilter;
  search: string | null;
};

export type ClientInvoiceListRow = {
  id: string;
  invoiceNumber: string;
  status: ClientInvoiceStatusValue;
  totalAmount: number;
  paidAmount: number | null;
  /** Total less payments received, never below zero (lib/finance/receivables). */
  amountOwing: number;
  periodStart: string | null;
  periodEnd: string | null;
  sentAt: string | null;
  paidAt: string | null;
  paidDate: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  createdAt: string;
  /**
   * The due day printed on the PDF (created + payment terms), as yyyy-MM-dd.
   * Derived from current settings exactly as the PDF is; not a stored field.
   */
  dueDate: string;
  overdue: boolean;
  xeroInvoiceId: string | null;
  xeroExportedAt: string | null;
  xeroState: ClientInvoiceXeroState;
  client: { id: string; name: string; email: string | null };
};

export type ClientInvoiceCounts = {
  all: number;
  active: number;
  needsAction: number;
  overdue: number;
  byStatus: Record<ClientInvoiceStatusValue, number>;
};

export type ClientInvoiceListPayload = {
  rows: ClientInvoiceListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  sort: ClientInvoiceSort;
  dir: "asc" | "desc";
  counts: ClientInvoiceCounts;
  paymentTermsDays: number;
  /** Today in the organisation timezone (yyyy-MM-dd), for "in N days" wording. */
  today: string;
};

/** Bulk actions the bulk route accepts. */
export const CLIENT_INVOICE_BULK_ACTIONS = ["approve", "send", "approve-and-send", "xero-push"] as const;
export type ClientInvoiceBulkAction = (typeof CLIENT_INVOICE_BULK_ACTIONS)[number];
export const CLIENT_INVOICE_BULK_MAX_IDS = 50;

/**
 * done: the action happened. refused: a guard or the provider said no.
 * unchanged: nothing needed doing (already approved, already in Xero).
 */
export type BulkRowOutcome = "done" | "refused" | "unchanged";

export type ClientInvoiceBulkResult = {
  id: string;
  invoiceNumber: string | null;
  ok: boolean;
  outcome: BulkRowOutcome;
  reason?: string;
};

export type ClientInvoiceBulkResponse = {
  action: ClientInvoiceBulkAction;
  results: ClientInvoiceBulkResult[];
  summary: { done: number; refused: number; unchanged: number };
};
