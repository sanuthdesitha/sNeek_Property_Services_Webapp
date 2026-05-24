/**
 * Auto-create a QA assignment when a job moves to COMPLETED.
 *
 * Idempotent — does nothing if a QaAssignment already exists for the job.
 * Used as a side effect from job status transitions; callers should swallow
 * errors so the parent operation never fails because of QA scaffolding.
 */
import { db } from "@/lib/db";

export async function ensureQaAssignmentForCompletedJob(jobId: string): Promise<void> {
  if (!jobId) return;

  const existing = await db.qaAssignment.findFirst({
    where: { jobId },
    select: { id: true },
  });
  if (existing) return;

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true },
  });
  if (!job) return;

  await db.qaAssignment.create({
    data: {
      jobId,
      status: "OPEN",
    },
  });
}

/**
 * Best-effort wrapper — log and swallow errors. Use this when calling from
 * job-transition code paths where the QA assignment should not block the
 * primary status update.
 */
export async function tryEnsureQaAssignmentForCompletedJob(jobId: string): Promise<void> {
  try {
    await ensureQaAssignmentForCompletedJob(jobId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[qa] failed to ensure QaAssignment for job", jobId, err);
  }
}
