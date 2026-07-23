/**
 * Surface prior negative QA feedback to a cleaner so they can self-correct
 * before starting a job at a property where they previously fell short.
 *
 * The authoritative score lives on QAReview (a real "QA" inspection outranks
 * an "ADMIN" quick score — see lib/qa/authority.ts), NOT on QaFormSubmission:
 * the submission's legacy percent is 0 when an inspection was graded purely
 * with accountability verdicts. QaFormSubmission is only consulted for the
 * cleaner-visible feedback text of the matched job.
 *
 * Sub-pass = the review failed, or scored < 80% (PASS_THRESHOLD).
 * Band: <60% or a failed review → "FAIL", otherwise "WARNING".
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
 * Returns the most recent sub-pass authoritative QA review for this cleaner at
 * this property, or null if no prior QA history fell below the pass threshold.
 *
 * We look back at the 5 most recent reviewed jobs at the property where the
 * cleaner was on the assignment roster; per job the authoritative review is
 * the latest of kind "QA", else the latest "ADMIN". First sub-pass match wins.
 */
export async function getNegativeQaWarning(
  cleanerUserId: string,
  propertyId: string
): Promise<PriorQaFeedback | null> {
  if (!cleanerUserId || !propertyId) return null;

  const reviews = await db.qAReview.findMany({
    where: {
      kind: { in: ["QA", "ADMIN"] },
      job: {
        propertyId,
        assignments: { some: { userId: cleanerUserId, removedAt: null } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      jobId: true,
      score: true,
      passed: true,
      kind: true,
      notes: true,
      createdAt: true,
      job: { select: { id: true, jobNumber: true } },
    },
  });

  // Latest authoritative review per job: "QA" outranks "ADMIN"; within a kind
  // the newest wins (rows arrive createdAt-desc, so first seen is the newest).
  const authoritativeByJob = new Map<string, (typeof reviews)[number]>();
  for (const review of reviews) {
    const held = authoritativeByJob.get(review.jobId);
    if (!held || (review.kind === "QA" && held.kind !== "QA")) {
      authoritativeByJob.set(review.jobId, review);
    }
  }

  for (const review of Array.from(authoritativeByJob.values()).slice(0, 5)) {
    const percent = Math.round(review.score);
    if (review.passed && percent >= PASS_THRESHOLD) continue;

    // The seed templates use `cleaner-feedback` (longtext) as the cleaner-
    // visible note. Pull it from the matched job's QA submission, if one
    // exists; fall back to the review's notes for the inspector text.
    const submission = await db.qaFormSubmission.findFirst({
      where: { jobId: review.jobId },
      orderBy: { createdAt: "desc" },
      select: { notes: true, data: true },
    });
    const cleanerFeedback = readStringField(submission?.data, "cleaner-feedback");

    return {
      jobId: review.job.id,
      jobNumber: review.job.jobNumber,
      scoredAt: review.createdAt,
      percent,
      band: percent < WARN_THRESHOLD || !review.passed ? "FAIL" : "WARNING",
      inspectorNotes: (review.notes ?? submission?.notes)?.trim() || null,
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
