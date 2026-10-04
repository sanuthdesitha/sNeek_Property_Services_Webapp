import { JobStatus, Prisma } from "@prisma/client";

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
    select: { status: true, payrollRunId: true, cleanerPaidAt: true, invoiceLines: { take: 1, select: { id: true } } },
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
