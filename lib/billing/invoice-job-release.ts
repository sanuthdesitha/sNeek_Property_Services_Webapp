/**
 * Returning jobs to billable when the invoice that billed them stops billing
 * them: the invoice is VOIDED (standard void or reconciled void), a DRAFT is
 * DELETED, or approved/sent credit notes FULLY credit it.
 *
 * The shared rule (`lib/invoicing/invoiced-job-rule.ts`) already treats such a
 * job as not invoiced. This keeps the job's STATUS truthful too: a job marked
 * INVOICED that has no other live invoice line goes back to the status it had
 * before it was marked invoiced (from its audit history), else COMPLETED, in
 * the caller's transaction, with an audit row per job.
 *
 * Nothing here touches any invoice's lines, totals, number or payments. A
 * partial credit note does not release anything. Reissuing (a new invoice
 * containing the job) bills it again through the generator's existing path.
 */
import { ClientInvoiceStatus, JobStatus, Prisma } from "@prisma/client";
import { creditedAmountOf, CREDIT_REDUCING_STATUSES } from "@/lib/finance/receivables";
import { LIVE_INVOICE_LINE_WHERE, creditsCoverInvoice } from "@/lib/invoicing/invoiced-job-rule";

export type JobReleaseReason = "voided" | "deleted" | "fully credited";

export type ReleasedJob = { jobId: string; from: JobStatus; to: JobStatus };

const JOB_STATUSES = new Set<string>(Object.values(JobStatus));

/** The status a job had before it was marked INVOICED, read from its audit rows. */
export function statusBeforeInvoiced(rows: ReadonlyArray<{ before: Prisma.JsonValue | null; after: Prisma.JsonValue | null }>): JobStatus {
  for (const row of rows) {
    const after = row.after as { status?: unknown } | null;
    const before = row.before as { status?: unknown } | null;
    if (after?.status !== JobStatus.INVOICED) continue;
    const previous = typeof before?.status === "string" ? before.status : null;
    if (previous && previous !== JobStatus.INVOICED && JOB_STATUSES.has(previous)) return previous as JobStatus;
    break; // The latest "marked invoiced" row has no earlier status recorded.
  }
  return JobStatus.COMPLETED;
}

/**
 * Jobs on `invoiceId` that are marked INVOICED and have no live line on any
 * OTHER invoice go back to billable. Call inside the transaction that voids,
 * deletes (before the delete, while the lines exist) or fully credits it.
 */
export async function returnInvoicedJobsToBillable(
  tx: Prisma.TransactionClient,
  input: { invoiceId: string; invoiceNumber: string; reason: JobReleaseReason; actorId: string },
): Promise<ReleasedJob[]> {
  const lines = await tx.clientInvoiceLine.findMany({
    where: { invoiceId: input.invoiceId, jobId: { not: null } },
    select: { jobId: true },
  });
  const jobIds = Array.from(new Set(lines.map((line) => line.jobId).filter((id): id is string => Boolean(id)))).sort();
  if (jobIds.length === 0) return [];
  for (const id of jobIds) await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${id} FOR UPDATE`;
  const candidates = await tx.job.findMany({
    where: {
      id: { in: jobIds },
      status: JobStatus.INVOICED,
      invoiceLines: { none: { ...LIVE_INVOICE_LINE_WHERE, invoiceId: { not: input.invoiceId } } },
    },
    select: { id: true },
  });
  const released: ReleasedJob[] = [];
  for (const job of candidates) {
    const history = await tx.auditLog.findMany({
      where: { jobId: job.id, entity: "Job" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { before: true, after: true },
    });
    const to = statusBeforeInvoiced(history);
    const changed = await tx.job.updateMany({ where: { id: job.id, status: JobStatus.INVOICED }, data: { status: to } });
    if (changed.count !== 1) continue;
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        jobId: job.id,
        action: "JOB_RETURNED_TO_BILLABLE",
        entity: "Job",
        entityId: job.id,
        before: { status: JobStatus.INVOICED },
        after: {
          status: to,
          invoiceId: input.invoiceId,
          invoiceNumber: input.invoiceNumber,
          note: `Returned to billable: invoice ${input.invoiceNumber} ${input.reason}`,
        },
      },
    });
    released.push({ jobId: job.id, from: JobStatus.INVOICED, to });
  }
  return released;
}

export type CreditCoverageResult = { fullyCredited: boolean; changed: boolean; released: ReleasedJob[] };

/**
 * Recompute whether approved/sent credit notes cover `invoiceId`'s whole total
 * and store it in `creditedInFullAt` (the column the shared rule reads). When it
 * becomes fully credited, its INVOICED jobs return to billable. Call in the
 * transaction that changed a credit note's status, after the change.
 */
export async function refreshCreditCoverage(
  tx: Prisma.TransactionClient,
  input: { invoiceId: string; actorId: string },
): Promise<CreditCoverageResult> {
  await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
  const invoice = await tx.clientInvoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true,
      kind: true,
      status: true,
      invoiceNumber: true,
      totalAmount: true,
      creditedInFullAt: true,
      creditNotes: { where: { status: { in: [...CREDIT_REDUCING_STATUSES] as ClientInvoiceStatus[] } }, select: { status: true, totalAmount: true } },
    },
  });
  if (!invoice || invoice.kind !== "INVOICE") return { fullyCredited: false, changed: false, released: [] };
  const covered = invoice.status !== ClientInvoiceStatus.VOID && creditsCoverInvoice(invoice.totalAmount, creditedAmountOf(invoice.creditNotes));
  const wasCovered = invoice.creditedInFullAt !== null;
  if (covered === wasCovered) return { fullyCredited: covered, changed: false, released: [] };
  await tx.clientInvoice.update({ where: { id: invoice.id }, data: { creditedInFullAt: covered ? new Date() : null } });
  const released = covered
    ? await returnInvoicedJobsToBillable(tx, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        reason: "fully credited",
        actorId: input.actorId,
      })
    : [];
  return { fullyCredited: covered, changed: true, released };
}

/**
 * Refusal when voiding a credit note would make the invoice it credits bill
 * its jobs again while one of those jobs has since been billed on another
 * live invoice (that would bill the same work twice).
 */
export async function creditNoteVoidRebillRefusal(
  tx: Prisma.TransactionClient,
  creditNote: { id: string; creditsInvoiceId: string | null },
): Promise<string | null> {
  if (!creditNote.creditsInvoiceId) return null;
  const original = await tx.clientInvoice.findUnique({
    where: { id: creditNote.creditsInvoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      creditedInFullAt: true,
      lines: { where: { jobId: { not: null } }, select: { jobId: true } },
      creditNotes: {
        where: { id: { not: creditNote.id }, status: { in: [...CREDIT_REDUCING_STATUSES] as ClientInvoiceStatus[] } },
        select: { status: true, totalAmount: true },
      },
    },
  });
  if (!original?.creditedInFullAt) return null;
  // Other credit notes still cover it: nothing becomes billed again.
  if (creditsCoverInvoice(original.totalAmount, creditedAmountOf(original.creditNotes))) return null;
  const jobIds = original.lines.map((line) => line.jobId).filter((id): id is string => Boolean(id));
  if (jobIds.length === 0) return null;
  const rebilled = await tx.clientInvoiceLine.findFirst({
    where: { jobId: { in: jobIds }, invoiceId: { not: original.id }, ...LIVE_INVOICE_LINE_WHERE },
    select: { invoice: { select: { invoiceNumber: true } } },
  });
  if (!rebilled) return null;
  return `Work on ${original.invoiceNumber} has since been billed on ${rebilled.invoice.invoiceNumber}. Voiding this credit note would bill it twice; credit or void ${rebilled.invoice.invoiceNumber} first.`;
}
