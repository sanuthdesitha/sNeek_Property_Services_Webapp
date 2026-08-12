// Quick / automatic QA scoring for jobs that never got a real inspection.
//
// THE RULE THAT MAKES THIS SAFE: a real on-site inspection (QAReview kind "QA")
// is authoritative and is never overwritten — neither the admin quick score nor
// the 24h auto score touches a job that has one. Both paths file their own
// review (kind "ADMIN" / "AUTO") and then defer to lib/qa/authority.ts to derive
// the job's status, so ranking stays in one place.
//
// Both surfaces share `applyQuickQaScore`, so a bulk approval and the nightly
// sweep behave identically (same audit shape, same cleaner notification, same
// completion side-effects).

import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { recomputeJobQaOutcome } from "@/lib/qa/authority";
import { suggestQaScore, type SuggestedScore } from "@/lib/qa/suggested-score";
import { awardLoyaltyForCompletedJob } from "@/lib/client/rewards";
import { scheduleJobFollowUps } from "@/lib/ops/follow-up-sequences";
import { notifyQaResultToCleaner } from "@/lib/notifications/accountability";

/** Statuses a quick score may act on — mirrors the admin QA route's gate. */
const SCOREABLE: JobStatus[] = [JobStatus.SUBMITTED, JobStatus.QA_REVIEW];

export type AwaitingQaJob = {
  jobId: string;
  jobNumber: string;
  propertyName: string;
  suburb: string;
  jobTypeLabel: string;
  scheduledDate: Date;
  submittedAt: Date | null;
  cleanerNames: string[];
  /** Hours since the cleaner submitted. */
  hoursSinceSubmission: number | null;
  suggestion: SuggestedScore;
};

const AWAITING_INCLUDE = {
  property: { select: { name: true, suburb: true, hasBalcony: true } },
  assignments: {
    where: { removedAt: null },
    select: { user: { select: { name: true } } },
  },
  formSubmissions: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    include: { media: { select: { fieldId: true } } },
  },
} as const;

/**
 * Jobs sitting in SUBMITTED/QA_REVIEW with NO real QA inspection, each with a
 * suggested score. `olderThanHours` restricts to submissions at least that old
 * — the auto-sweep's window.
 */
export async function listJobsAwaitingQuickScore(params?: {
  olderThanHours?: number;
  limit?: number;
  now?: Date;
}): Promise<AwaitingQaJob[]> {
  const now = params?.now ?? new Date();
  const jobs = await db.job.findMany({
    where: {
      status: { in: SCOREABLE },
      // "No real inspection" — an ADMIN/AUTO review does not disqualify a job
      // from being scored here, but a QA one makes it untouchable.
      qaReviews: { none: { kind: "QA" } },
      formSubmissions: { some: {} },
    },
    include: AWAITING_INCLUDE,
    orderBy: { scheduledDate: "asc" },
    take: params?.limit ?? 200,
  });

  const cutoffMs =
    typeof params?.olderThanHours === "number" ? params.olderThanHours * 3_600_000 : null;

  const rows: AwaitingQaJob[] = [];
  for (const job of jobs) {
    const submission = job.formSubmissions[0];
    if (!submission) continue;
    const ageMs = now.getTime() - submission.createdAt.getTime();
    if (cutoffMs != null && ageMs < cutoffMs) continue;

    rows.push({
      jobId: job.id,
      jobNumber: job.jobNumber ?? job.id.slice(-6),
      propertyName: job.property?.name ?? "Property",
      suburb: job.property?.suburb ?? "",
      jobTypeLabel: String(job.jobType ?? "").replace(/_/g, " "),
      scheduledDate: job.scheduledDate,
      submittedAt: submission.createdAt,
      cleanerNames: job.assignments
        .map((a) => a.user?.name?.trim())
        .filter((n): n is string => Boolean(n)),
      hoursSinceSubmission: Math.floor(ageMs / 3_600_000),
      suggestion: suggestQaScore({
        data: submission.data,
        media: submission.media,
        property: (job.property ?? {}) as Record<string, unknown>,
      }),
    });
  }
  return rows;
}

export type QuickScoreOutcome =
  | { ok: true; jobId: string; score: number; passed: boolean }
  | { ok: false; jobId: string; reason: "NOT_FOUND" | "NOT_SCOREABLE" | "REAL_QA_EXISTS" };

/**
 * File a quick QA review and let authority derive the job outcome.
 *
 * `kind` is "ADMIN" for an admin's manual/bulk score and "AUTO" for the sweep.
 * `actorUserId` is null for AUTO (nobody pressed anything).
 */
export async function applyQuickQaScore(params: {
  jobId: string;
  score: number;
  kind: "ADMIN" | "AUTO";
  actorUserId?: string | null;
  notes?: string | null;
  /** Pass/fail threshold; defaults to settings.qaAutomation.failureThreshold. */
  threshold?: number;
}): Promise<QuickScoreOutcome> {
  const settings = await getAppSettings();
  const threshold = params.threshold ?? settings.qaAutomation.failureThreshold;
  const score = Math.max(0, Math.min(100, Math.round(params.score)));

  const job = await db.job.findUnique({
    where: { id: params.jobId },
    select: {
      id: true,
      status: true,
      qaReviews: { where: { kind: "QA" }, select: { id: true }, take: 1 },
    },
  });
  if (!job) return { ok: false, jobId: params.jobId, reason: "NOT_FOUND" };
  if (!SCOREABLE.includes(job.status)) {
    return { ok: false, jobId: params.jobId, reason: "NOT_SCOREABLE" };
  }
  // A real inspection owns this job's score — never overwrite it.
  if (job.qaReviews.length > 0) {
    return { ok: false, jobId: params.jobId, reason: "REAL_QA_EXISTS" };
  }

  const passed = score >= threshold;

  await db.$transaction(async (tx) => {
    // Serialize concurrent scoring of the same job (bulk click racing the sweep).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.jobId}))`;

    await tx.qAReview.create({
      data: {
        jobId: params.jobId,
        reviewedById: params.actorUserId ?? null,
        score,
        passed,
        kind: params.kind,
        notes: params.notes?.trim() || undefined,
        flags: [],
      },
    });

    // AuditLog.userId is a required FK to a real user, so the unattended sweep
    // cannot write one without inventing an actor. For AUTO runs the QAReview
    // row itself is the durable record — kind "AUTO", reviewedById null, and
    // notes stating the rule and the deductions that produced the score.
    if (params.actorUserId) {
      await tx.auditLog.create({
        data: {
          userId: params.actorUserId,
          jobId: params.jobId,
          action: "QA_QUICK_SCORE",
          entity: "Job",
          entityId: params.jobId,
          after: { score, passed, threshold, kind: params.kind } as any,
        },
      });
    }
  });

  // Authority derives status/completedAt (and defers to a QA review if one
  // landed in the meantime).
  await recomputeJobQaOutcome(params.jobId).catch(() => null);

  if (passed) {
    await Promise.allSettled([
      awardLoyaltyForCompletedJob(params.jobId),
      scheduleJobFollowUps(params.jobId),
    ]);
  }

  void notifyQaResultToCleaner({ jobId: params.jobId, score, passed }).catch((err) =>
    logger.error({ err, jobId: params.jobId }, "QA quick score: cleaner notification failed")
  );

  return { ok: true, jobId: params.jobId, score, passed };
}

/**
 * Auto-score sweep: every job submitted more than `qaAutomation.autoScoreAfterHours`
 * ago with no real inspection gets its suggested score applied as an AUTO review.
 * Disabled when `qaAutomation.autoScoreEnabled` is false.
 */
export async function runQaAutoScoreSweep(params?: { now?: Date }): Promise<{
  considered: number;
  scored: number;
  skipped: number;
}> {
  const settings = await getAppSettings();
  const { autoScoreEnabled, autoScoreAfterHours, failureThreshold } = settings.qaAutomation;
  if (!autoScoreEnabled) return { considered: 0, scored: 0, skipped: 0 };

  const candidates = await listJobsAwaitingQuickScore({
    olderThanHours: autoScoreAfterHours,
    now: params?.now,
    limit: 200,
  });

  let scored = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    try {
      const result = await applyQuickQaScore({
        jobId: candidate.jobId,
        score: candidate.suggestion.score,
        kind: "AUTO",
        actorUserId: null,
        threshold: failureThreshold,
        notes: `Auto-scored after ${autoScoreAfterHours}h with no QA inspection. ${candidate.suggestion.summary}`,
      });
      if (result.ok) scored += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      logger.error({ err, jobId: candidate.jobId }, "[qa-auto-score] job failed");
    }
  }

  if (scored > 0 || skipped > 0) {
    logger.info({ considered: candidates.length, scored, skipped }, "[qa-auto-score] sweep complete");
  }
  return { considered: candidates.length, scored, skipped };
}
