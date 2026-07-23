/**
 * DB-backed companion to the pure `lib/qa/reopen.ts` policy module: counts what
 * a job's QA inspection already set in motion (rework jobs, pay adjustments,
 * actioned issues) so the reopen flow can WARN about money it will not reverse.
 *
 * Read-only by construction — nothing here writes.
 */
import { db } from "@/lib/db";
import type { ReopenMoneyFacts } from "@/lib/qa/reopen";

/** Rework job statuses that mean nobody has started the fix yet. */
const UNSTARTED_REWORK_STATUSES = new Set(["UNASSIGNED", "OFFERED", "ASSIGNED"]);

export async function collectReopenMoneyFacts(
  jobId: string,
  reviewId: string | null
): Promise<ReopenMoneyFacts> {
  const [reworkJobs, adjustments, issues] = await Promise.all([
    db.job
      .findMany({ where: { reworkOfJobId: jobId, isRework: true }, select: { status: true } })
      .catch(() => [] as Array<{ status: string }>),
    db.cleanerPayAdjustment
      .findMany({
        where: { jobId },
        select: { status: true, approvedAmount: true, includedInPayrollRunId: true },
      })
      .catch(
        () =>
          [] as Array<{ status: string; approvedAmount: number | null; includedInPayrollRunId: string | null }>
      ),
    reviewId
      ? db.qaIssue
          .findMany({
            where: { qaReviewId: reviewId },
            select: { payAdjustmentId: true, rectificationStatus: true },
          })
          .catch(() => [] as Array<{ payAdjustmentId: string | null; rectificationStatus: string }>)
      : Promise.resolve([] as Array<{ payAdjustmentId: string | null; rectificationStatus: string }>),
  ]);

  return {
    reworkJobCount: reworkJobs.length,
    startedReworkJobCount: reworkJobs.filter((j) => !UNSTARTED_REWORK_STATUSES.has(String(j.status)))
      .length,
    payAdjustmentCount: adjustments.length,
    settledPayAdjustmentCount: adjustments.filter(
      (a) => Boolean(a.includedInPayrollRunId) || String(a.status) === "APPROVED" || a.approvedAmount != null
    ).length,
    issuesWithPayAdjustmentCount: issues.filter((i) => Boolean(i.payAdjustmentId)).length,
    actionedIssueCount: issues.filter(
      (i) => !i.payAdjustmentId && String(i.rectificationStatus) !== "PENDING"
    ).length,
  };
}
