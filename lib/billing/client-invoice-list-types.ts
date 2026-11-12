/**
 * Shapes shared by the client-invoice list route and the admin screen. Kept
 * free of server imports so client components can import them.
 */

export const CLIENT_INVOICE_STATUSES = ["DRAFT", "APPROVED", "SENT", "PART_PAID", "PAID", "VOID"] as const;
export type ClientInvoiceStatusValue = (typeof CLIENT_INVOICE_STATUSES)[number];

/**
 * Columns the list route can sort by. Each maps to a real column, except
 * "owing", which is ordered in SQL by the same arithmetic as
 * invoiceAmountOwing (lib/billing/client-invoice-owing-sql.ts).
 */
export const CLIENT_INVOICE_SORTS = ["number", "client", "period", "created", "sent", "total", "owing", "status", "xero"] as const;
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
 * Xero state from the stored export metadata and the status pull. Since Wave D
 * a failed push is recorded as FAILED, so "pending" (in flight or cut off) and
 * "failed" (the provider refused or could not be reached) are separate.
 */
export const CLIENT_INVOICE_XERO_FILTERS = [
  "any",
  "none",
  "pushed",
  "pending",
  "failed",
  // In Xero, never read back by the status pull.
  "unchecked",
  // From the Xero status pull (metadata.xeroSync.state).
  "in-xero",
  "paid-in-xero",
  "needs-review",
  "unknown",
] as const;
export type ClientInvoiceXeroFilter = (typeof CLIENT_INVOICE_XERO_FILTERS)[number];
/** PENDING covers an open reservation, in flight or failed; see xeroPushFailure for which. */
export type ClientInvoiceXeroState = "NONE" | "PUSHED" | "PENDING";

/** A failed push: the provider's sanitised reason and when (ISO; may be blank on old rows). */
export type ClientInvoiceXeroPushFailure = { reason: string; at: string };

/** The last Xero status pull for this invoice, from metadata.xeroSync; null when never checked. */
export type ClientInvoiceXeroSyncView = {
  state: "IN_XERO" | "PAID_IN_XERO" | "NEEDS_REVIEW" | "UNKNOWN";
  reason: string | null;
  xeroStatus: string | null;
  checkedAt: string;
  lastReadAt: string | null;
};

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
  /**
   * Total less payments received and approved/sent credit notes, never below
   * zero (lib/finance/receivables). Always 0 on a credit note.
   */
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
  /** The terms this row's due day uses: the invoice's snapshot, else its client's terms, else the default. */
  paymentTermsDays: number;
  overdue: boolean;
  xeroInvoiceId: string | null;
  xeroExportedAt: string | null;
  xeroState: ClientInvoiceXeroState;
  /** Set while the reservation is FAILED (Wave D); null when pending, exported or never pushed. */
  xeroPushFailure: ClientInvoiceXeroPushFailure | null;
  xeroSync: ClientInvoiceXeroSyncView | null;
  /**
   * DRAFT rows only: job lines whose job resolves no client rate now (the rule
   * approval enforces, lib/billing/missing-rates.ts). Null on other statuses,
   * or when it could not be read.
   */
  missingRateJobs: number | null;
  client: { id: string; name: string; email: string | null };
  kind: ClientInvoiceKindValue;
  /** The client's reference / PO number. */
  clientReference: string | null;
  /** Approved or sent credit notes against this invoice (positive). 0 on a credit note. */
  creditedAmount: number;
  /**
   * Display state, not a status: unpaid and fully covered by credit notes.
   * The status stays SENT/PART_PAID so the transition graph is unchanged.
   */
  fullyCredited: boolean;
  /** On a credit note: the invoice it credits. */
  credits: ClientInvoiceLink | null;
  /** On an invoice: every credit note raised against it (any status). */
  creditedBy: Array<ClientInvoiceLink & { status: ClientInvoiceStatusValue; totalAmount: number }>;
};

export type ClientInvoiceKindValue = "INVOICE" | "CREDIT_NOTE";
export type ClientInvoiceLink = { id: string; invoiceNumber: string };

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
