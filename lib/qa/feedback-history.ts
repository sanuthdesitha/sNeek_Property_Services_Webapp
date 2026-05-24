/**
 * Surface prior negative QA feedback to a cleaner so they can self-correct
 * before starting a job at a property where they previously fell short.
 *
 * Sub-pass = QA score < 80% (matches PASS_THRESHOLD in lib/qa/scoring.ts).
 * <60% returns band "FAIL", 60-79% returns band "WARNING".
 */
import { db } from "@/lib/db";
import { PASS_THRESHOLD, WARN_THRESHOLD, type QaBand } from "./scoring";

export interface PriorQaFeedback {
  jobId: string;
  jobNumber: string;
  scoredAt: Date;
  percent: number;
  band: Exclude<QaBand, "PASS">;
  inspectorNotes: string | null;
  cleanerFeedback: string | null;
}

/**
 * Returns the most recent sub-pass QA submission for this cleaner at this
 * property, or null if no prior QA history fell below the pass threshold.
 *
 * We look back at the 5 most recent QA submissions for the property where
 * the cleaner was on the assignment roster; first sub-pass match wins.
 */
export async function getNegativeQaWarning(
  cleanerUserId: string,
  propertyId: string
): Promise<PriorQaFeedback | null> {
  if (!cleanerUserId || !propertyId) return null;

  const submissions = await db.qaFormSubmission.findMany({
    where: {
      job: {
        propertyId,
        assignments: { some: { userId: cleanerUserId, removedAt: null } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      score: true,
      notes: true,
      data: true,
      createdAt: true,
      job: { select: { id: true, jobNumber: true } },
    },
  });

  for (const submission of submissions) {
    const percent = Math.round(submission.score);
    if (percent >= PASS_THRESHOLD) continue;

    // The seed templates use `cleaner-feedback` (longtext) as the cleaner-
    // visible note. Pull from submission.data; fall back to the inspector's
    // private notes if no dedicated cleaner-feedback was captured.
    const cleanerFeedback = readStringField(submission.data, "cleaner-feedback");

    return {
      jobId: submission.job.id,
      jobNumber: submission.job.jobNumber,
      scoredAt: submission.createdAt,
      percent,
      band: percent < WARN_THRESHOLD ? "FAIL" : "WARNING",
      inspectorNotes: submission.notes?.trim() || null,
      cleanerFeedback: cleanerFeedback || null,
    };
  }

  return null;
}

function readStringField(data: unknown, key: string): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = (data as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
