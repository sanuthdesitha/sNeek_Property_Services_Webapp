import "server-only";
import { JobStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { measurePhoto, SocialImageError } from "./image-pipeline";
import { SOCIAL_FIELD_IDS, socialPhotoField } from "./photo-fields";
import { measuredScore, SOCIAL_SCORE_VERSION } from "./scoring-rules";
import { readEvidencePhoto } from "./storage";

/**
 * Social photo scores (2026-11-17): pg-boss `social-photo-score` every 10
 * minutes and "Score now" on the candidates screen, never inside a page
 * request. Only allowlisted fields of finished jobs from the last 90 days,
 * after the photo integrity check has read the photo. A photo that cannot
 * be read gets a row with score null and the reason ("Could not be
 * scored"), never a low score. The evidence file is only read.
 */

const SAFE_ERRORS = new Set([
  "The photo could not be read as an image.",
  "Too short once the stamp is removed.",
  "This photo's storage location is not supported.",
  "The stored photo is empty or too large.",
  "The stored photo could not be read.",
]);

export async function scoreOnePhoto(row: { id: string; fieldId: string; s3Key: string; submission: { jobId: string; job: { propertyId: string } } }): Promise<"scored" | "failed"> {
  const field = socialPhotoField(row.fieldId);
  if (!field) return "failed";
  const base = { submissionMediaId: row.id, jobId: row.submission.jobId, propertyId: row.submission.job.propertyId, version: SOCIAL_SCORE_VERSION, fieldKind: field.kind, computedAt: new Date() };
  try {
    const bytes = await readEvidencePhoto(row.s3Key);
    const measurements = await measurePhoto(bytes, field.kind);
    const measured = measuredScore(measurements);
    const data = {
      ...base,
      score: measured.points,
      components: { ...measured.components, leftOut: measured.leftOut } as Prisma.InputJsonValue,
      reasons: measured.reasons as Prisma.InputJsonValue,
      width: measurements.width,
      height: measurements.height,
      laplacianVar: measurements.laplacianVar,
      meanLuma: measurements.meanLuma,
      clipLow: measurements.clipLow,
      clipHigh: measurements.clipHigh,
      contrast: measurements.contrast,
      error: null,
    };
    await db.socialPhotoScore.upsert({ where: { submissionMediaId: row.id }, create: data, update: data });
    return "scored";
  } catch (error) {
    const message = error instanceof SocialImageError || (error instanceof Error && SAFE_ERRORS.has(error.message)) ? (error as Error).message : "The photo could not be read.";
    const data = { ...base, score: null, components: Prisma.DbNull, reasons: Prisma.DbNull, width: null, height: null, laplacianVar: null, meanLuma: null, clipLow: null, clipHigh: null, contrast: null, error: message };
    await db.socialPhotoScore.upsert({ where: { submissionMediaId: row.id }, create: data, update: data }).catch(() => undefined);
    return "failed";
  }
}

/** Photos waiting for a score of the current version, newest jobs first. */
export async function processSocialScoreQueue(input: { batch?: number; jobIds?: string[]; now?: Date } = {}): Promise<{ scored: number; failed: number; waiting: number }> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const where: Prisma.SubmissionMediaWhereInput = {
    mediaType: "PHOTO",
    fieldId: { in: [...SOCIAL_FIELD_IDS] },
    integrityCheckedAt: { not: null },
    integrityError: null,
    submission: {
      job: {
        status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] },
        ...(input.jobIds ? { id: { in: input.jobIds } } : { OR: [{ completedAt: { gte: since } }, { completedAt: null, scheduledDate: { gte: since } }] }),
      },
    },
  };
  const candidates = await db.submissionMedia.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: 2000,
    select: { id: true, fieldId: true, s3Key: true, submission: { select: { jobId: true, job: { select: { propertyId: true } } } } },
  });
  const existing = await db.socialPhotoScore.findMany({ where: { submissionMediaId: { in: candidates.map((row) => row.id) }, version: SOCIAL_SCORE_VERSION }, select: { submissionMediaId: true } });
  const done = new Set(existing.map((row) => row.submissionMediaId));
  const waiting = candidates.filter((row) => !done.has(row.id));
  let scored = 0;
  let failed = 0;
  for (const row of waiting.slice(0, input.batch ?? 40)) {
    if ((await scoreOnePhoto(row)) === "scored") scored += 1;
    else failed += 1;
  }
  return { scored, failed, waiting: Math.max(0, waiting.length - scored - failed) };
}
