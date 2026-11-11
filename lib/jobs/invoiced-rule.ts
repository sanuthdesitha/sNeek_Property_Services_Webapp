/**
 * "Is this job invoiced?" for the Jobs screens.
 *
 * A job counts as invoiced when it is marked INVOICED or has a line on an
 * invoice that is NOT VOID. A line on a voided invoice does not count: voiding
 * frees the work to be billed again.
 *
 * MIRRORS `billedJobLinesWhere` in `lib/billing/client-invoices.ts` (the rule
 * the invoice generator uses to skip already-billed jobs: "a job line on any
 * non-VOID invoice"). That helper is scoped to one client and lives in a server
 * module, so the Jobs filter cannot import it; the same invoice-status test is
 * repeated here and `tests/lib/jobs-invoiced-rule.test.ts` pins the two to the
 * same cases. Change both together.
 *
 * The INVOICED job status is kept as an explicit "invoiced" marker, as the
 * Jobs filter always treated it; the generator does not set that status.
 */
import { ClientInvoiceStatus, JobStatus, Prisma } from "@prisma/client";

/** Invoice-line filter: the line sits on a live (non-VOID) invoice. */
export const LIVE_INVOICE_LINE_WHERE = {
  invoice: { status: { not: ClientInvoiceStatus.VOID } },
} satisfies Prisma.ClientInvoiceLineWhereInput;

/** Jobs filter "Invoiced". */
export const INVOICED_JOB_WHERE = {
  OR: [{ status: JobStatus.INVOICED }, { invoiceLines: { some: LIVE_INVOICE_LINE_WHERE } }],
} satisfies Prisma.JobWhereInput;

/** Jobs filter "Not invoiced". */
export const NOT_INVOICED_JOB_WHERE = {
  status: { not: JobStatus.INVOICED },
  invoiceLines: { none: LIVE_INVOICE_LINE_WHERE },
} satisfies Prisma.JobWhereInput;

/** SQL form for the grouped view counts (`j` is the Job alias). */
export function notInvoicedJobSql(): Prisma.Sql {
  return Prisma.sql`j."status"::text <> 'INVOICED' AND NOT EXISTS (SELECT 1 FROM "ClientInvoiceLine" l JOIN "ClientInvoice" i ON i."id" = l."invoiceId" WHERE l."jobId" = j."id" AND i."status"::text <> 'VOID')`;
}

export type JobInvoiceLineState = { invoice: { status: string } | null };

/** In-memory form for screens that already loaded a job's invoice lines. */
export function isLiveInvoiceLine(line: JobInvoiceLineState): boolean {
  return line.invoice !== null && line.invoice.status !== ClientInvoiceStatus.VOID;
}

export function isJobInvoiced(job: { status: string; invoiceLines: readonly JobInvoiceLineState[] }): boolean {
  return job.status === JobStatus.INVOICED || job.invoiceLines.some(isLiveInvoiceLine);
}
