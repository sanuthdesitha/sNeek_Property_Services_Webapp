import { JobStatus, Prisma } from "@prisma/client";
import { FINANCIAL_RECORD_LINE_WHERE } from "@/lib/invoicing/invoiced-job-rule";

export const JOB_DELETE_FINANCIAL_CONFLICT =
  "Job deletion is blocked by financial records. Preserve this job and review its invoices, payroll, or pay decisions instead.";

/** Call inside the deletion transaction, before deleting any dependent records. */
export async function assertJobCanBeDeleted(tx: Prisma.TransactionClient, jobId: string) {
  // The target lock serializes job invoice/payroll claims; QA can be claimed
  // independently, so lock those rows before reading their settlement stamps.
  await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${jobId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "QaAssignment" WHERE "jobId" = ${jobId} ORDER BY id FOR UPDATE`;
  const job = await tx.job.findUnique({
    where: { id: jobId },
    // A line on a VOID invoice is not a financial record that blocks deletion
    // (owner decision 2026-11-11). Lines on any other invoice, including a fully
    // credited one, do block. Deleting the job leaves a voided invoice's lines
    // intact: ClientInvoiceLine.jobId is ON DELETE SET NULL, and the line keeps
    // its own stored description, quantity and amounts.
    select: { status: true, payrollRunId: true, cleanerPaidAt: true, invoiceLines: { take: 1, where: FINANCIAL_RECORD_LINE_WHERE, select: { id: true } } },
  });
  if (!job) throw new Error("JOB_NOT_FOUND");
  const [adjustments, transfers, settledQa, cleanerClaim] = await Promise.all([
    // Like QA reset, retain pay-decision history even before settlement.
    tx.cleanerPayAdjustment.count({ where: { jobId } }),
    tx.qaReworkTransfer.count({ where: { jobId } }),
    tx.qaAssignment.count({ where: { jobId, OR: [
      { includedInPayrollRunId: { not: null } },
      { includedInCleanerInvoiceId: { not: null } },
      { paySettledAmount: { not: null } },
    ] } }),
    tx.cleanerInvoiceSubmission.findFirst({
      where: { status: { notIn: ["VOID", "CHANGES_REQUESTED"] }, lineData: { path: ["jobIds"], array_contains: [jobId] } },
      select: { id: true },
    }),
  ]);
  if (job.status === JobStatus.INVOICED || job.payrollRunId || job.cleanerPaidAt || job.invoiceLines.length || adjustments || transfers || settledQa || cleanerClaim) {
    throw new Error(JOB_DELETE_FINANCIAL_CONFLICT);
  }
}
