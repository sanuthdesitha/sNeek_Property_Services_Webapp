/**
 * The New invoice panel's "What the draft will hold" preview: shapes only.
 * Plain module (no server imports), safe for client components. Every amount
 * here was computed on the server by the generator's own functions
 * (computeClientCharge, calculateShoppingAwareInvoiceTotals); the panel only
 * displays them.
 */

/** Where a job's charge comes from (computeClientCharge's source). */
export type PreviewChargeSource = "FIXED_JOB" | "PROPERTY_RATE" | "JOBTYPE_PRICE" | "MISSING";

export type PreviewJob = {
  jobId: string;
  jobNumber: string | null;
  jobType: string;
  /** ISO instant; shown as a Sydney calendar day, like the invoice line. */
  scheduledDate: string;
  propertyId: string;
  propertyName: string;
  source: PreviewChargeSource;
  /** The line amount ex GST, or null when the job has no rate (never $0). */
  amount: number | null;
  /** The line description the draft would print, or null when no line. */
  lineDescription: string | null;
  /** The job's invoice note (printed under its line), if any. */
  note: string | null;
  /** True when a public holiday rate snapshot is applied to this job's fixed price. */
  holidayRate: boolean;
  /** For the in-place fixed-price fix (stale-write guard on the job). */
  updatedAt: string;
};

export type PreviewOtherLine = {
  key: string;
  kind: "SHOPPING" | "SHOPPING_CHARGE" | "REPAIR";
  description: string;
  amount: number;
};

export type PreviewLeftOut = {
  jobId: string;
  jobNumber: string | null;
  reason: "ALREADY_INVOICED" | "CANCELLED" | "SKIPPED";
  invoiceNumber: string | null;
};

export type PreviewTotals = { subtotal: number; gstAmount: number; totalAmount: number };

export type GeneratePreview = {
  client: { id: string; name: string };
  propertyId: string | null;
  period: { start: string | null; end: string | null };
  periodBasis: "SCHEDULED" | "SERVICE";
  gstEnabled: boolean;
  jobs: PreviewJob[];
  /** Jobs with no rate: the generator refuses the client unless they are left off. */
  unratedJobIds: string[];
  otherLines: PreviewOtherLine[];
  /** Totals of every line the draft would hold (unrated jobs never have a line). Null when there is no line. */
  totals: PreviewTotals | null;
  /** Totals of the charged job lines alone. Null when no job has a charge. */
  jobTotals: PreviewTotals | null;
  chargedJobCount: number;
  lineCount: number;
  leftOut: PreviewLeftOut[];
};

/** "Period starts where the client's last invoice ended, else the 1st of the month." */
export type PeriodDefault = {
  start: string;
  end: string;
  source: "LAST_INVOICE" | "MONTH_START";
  lastInvoiceNumber: string | null;
  lastPeriodEnd: string | null;
};

/** The answer to POST /api/admin/invoices/generate with a request key. */
export type GenerateRequestResponse = {
  id: string;
  invoiceNumber: string;
  totalAmount: number;
  lineCount: number;
  notBilled: Array<{ jobId: string; jobNumber: string | null }>;
  /** True when this answer was stored by an earlier request with the same key. */
  replayed: boolean;
};
