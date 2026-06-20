/**
 * QA review authority.
 *
 * A job can accumulate several QAReview rows over its life: an AUTO score, a
 * quick ADMIN score (an admin "just gives a number to pass"), and a real on-site
 * QA inspection. The owner rule is: **a real QA inspection always wins** — its
 * score and pass/fail decide the job, overriding any earlier admin/auto score.
 *
 * `kind` ranks authority: QA (3) > ADMIN (2) > AUTO (1). Within the same kind the
 * most recent review wins. Whenever reviews change (a new inspection, or an admin
 * editing/deleting a score) call `recomputeJobQaOutcome` to re-derive the job's
 * status + completion stamp from the current authoritative review.
 */
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";

export type QaReviewKind = "QA" | "ADMIN" | "AUTO";

const KIND_PRIORITY: Record<string, number> = { QA: 3, ADMIN: 2, AUTO: 1 };

type QaReviewRow = {
  id: string;
  jobId: string;
  score: number;
  passed: boolean;
  kind: string;
  createdAt: Date;
};

/** The single authoritative review for a job (highest kind, then most recent). */
export async function getAuthoritativeQaReview(jobId: string): Promise<QaReviewRow | null> {
  const reviews = await db.qAReview.findMany({
    where: { jobId },
    orderBy: { createdAt: "desc" },
    select: { id: true, jobId: true, score: true, passed: true, kind: true, createdAt: true },
  });
  if (reviews.length === 0) return null;
  return reviews.reduce((best, current) => {
    const bestPriority = KIND_PRIORITY[best.kind] ?? 1;
    const currentPriority = KIND_PRIORITY[current.kind] ?? 1;
    if (currentPriority > bestPriority) return current;
    if (currentPriority === bestPriority && current.createdAt > best.createdAt) return current;
    return best;
  });
}

/**
 * Re-derive Job.status + completedAt from the authoritative review. Never touches
 * INVOICED jobs (locked). When the authoritative review passed → COMPLETED and a
 * stable completedAt (keeps the existing stamp so payroll/invoice periods don't
 * shift on a later edit). When it failed → back to QA_REVIEW with no completion.
 * Returns the resolved outcome (or null when the job has no reviews yet).
 */
export async function recomputeJobQaOutcome(jobId: string): Promise<{
  status: JobStatus;
  passed: boolean;
  score: number;
} | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, completedAt: true },
  });
  if (!job) return null;
  if (job.status === JobStatus.INVOICED) return null;

  const review = await getAuthoritativeQaReview(jobId);
  if (!review) return null;

  const passed = review.passed;
  const status = passed ? JobStatus.COMPLETED : JobStatus.QA_REVIEW;
  const completedAt = passed ? job.completedAt ?? new Date() : null;

  await db.job.update({
    where: { id: jobId },
    data: { status, completedAt },
  });

  return { status, passed, score: review.score };
}
