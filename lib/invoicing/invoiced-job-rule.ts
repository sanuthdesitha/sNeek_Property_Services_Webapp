/**
 * THE rule for "is this job invoiced?", shared by the invoice generator
 * (`lib/billing/client-invoices.ts`), "Ready to bill" (`client-invoice-stats`),
 * the Jobs filter, view counts and the job detail Money tab
 * (`lib/jobs/invoiced-rule.ts`). Neutral module: no database client, no
 * server-only import, so both `lib/jobs` and `lib/billing` (and screens) can
 * use it. `tests/lib/jobs-invoiced-rule.test.ts` pins every consumer to it.
 *
 * A job is invoiced only while it has a line on a live invoice:
 *   - kind INVOICE (credit-note lines never carry a job),
 *   - status not VOID,
 *   - not fully credited (`creditedInFullAt` is null: approved/sent credit
 *     notes do not cover its whole total).
 * The INVOICED job status alone does NOT make a job invoiced (legacy rows with
 * the status but no live line are billable again; the migration
 * `20261112090000_finance_decisions` returns them to COMPLETED).
 *
 * A separate, wider test decides what is a FINANCIAL RECORD for delete/reset:
 * any line on a non-void invoice, including a fully credited one (an issued
 * document), but not a line on a voided invoice.
 */
import { ClientInvoiceKind, ClientInvoiceStatus, Prisma } from "@prisma/client";

/** Invoice filter: a live invoice whose job lines still bill their jobs. */
export const LIVE_INVOICE_WHERE = {
  kind: ClientInvoiceKind.INVOICE,
  status: { not: ClientInvoiceStatus.VOID },
  creditedInFullAt: null,
} satisfies Prisma.ClientInvoiceWhereInput;

/** Invoice-line filter: the line bills its job. */
export const LIVE_INVOICE_LINE_WHERE = {
  invoice: LIVE_INVOICE_WHERE,
} satisfies Prisma.ClientInvoiceLineWhereInput;

/** Invoice-line filter for delete/reset guards: the line is on a non-void (issued or draft) invoice. */
export const FINANCIAL_RECORD_LINE_WHERE = {
  invoice: { status: { not: ClientInvoiceStatus.VOID } },
} satisfies Prisma.ClientInvoiceLineWhereInput;

/** Job filter: invoiced. */
export const INVOICED_JOB_WHERE = {
  invoiceLines: { some: LIVE_INVOICE_LINE_WHERE },
} satisfies Prisma.JobWhereInput;

/** Job filter: not invoiced (billable as far as invoicing goes). */
export const NOT_INVOICED_JOB_WHERE = {
  invoiceLines: { none: LIVE_INVOICE_LINE_WHERE },
} satisfies Prisma.JobWhereInput;

/** SQL predicate on an invoice alias: the invoice is live (see LIVE_INVOICE_WHERE). */
export function liveInvoiceSql(alias: string): Prisma.Sql {
  const i = Prisma.raw(`"${alias.replace(/"/g, "")}"`);
  return Prisma.sql`${i}."kind"::text = 'INVOICE' AND ${i}."status"::text <> 'VOID' AND ${i}."creditedInFullAt" IS NULL`;
}

/** SQL predicate on a Job alias: the job is not invoiced. */
export function notInvoicedJobSql(jobAlias = "j"): Prisma.Sql {
  const j = Prisma.raw(`"${jobAlias.replace(/"/g, "")}"`);
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM "ClientInvoiceLine" l JOIN "ClientInvoice" i ON i."id" = l."invoiceId" WHERE l."jobId" = ${j}."id" AND ${liveInvoiceSql("i")})`;
}

/** What a screen needs to have loaded about a line's invoice. */
export type InvoiceLineState = {
  invoice: { status: string; kind?: string | null; creditedInFullAt?: Date | string | null } | null;
};

/** In-memory form of LIVE_INVOICE_LINE_WHERE. */
export function isLiveInvoiceLine(line: InvoiceLineState): boolean {
  const invoice = line.invoice;
  if (!invoice) return false;
  if (invoice.status === ClientInvoiceStatus.VOID) return false;
  if (invoice.kind && invoice.kind !== ClientInvoiceKind.INVOICE) return false;
  return !invoice.creditedInFullAt;
}

/** In-memory form of FINANCIAL_RECORD_LINE_WHERE. */
export function isFinancialRecordLine(line: InvoiceLineState): boolean {
  return line.invoice !== null && line.invoice.status !== ClientInvoiceStatus.VOID;
}

/** Invoiced = at least one live line. The job's status is not consulted. */
export function isJobInvoiced(job: { invoiceLines: readonly InvoiceLineState[] }): boolean {
  return job.invoiceLines.some(isLiveInvoiceLine);
}

/** Credits cover the whole total (the job-release threshold; half-cent tolerance as elsewhere). */
export function creditsCoverInvoice(totalAmount: number, creditedAmount: number): boolean {
  return creditedAmount > 0.005 && creditedAmount + 0.005 >= Number(totalAmount);
}
