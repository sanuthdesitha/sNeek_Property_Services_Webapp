import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getVisionSettings } from "./vision-settings";
import { visionSettingsSchema, type VisionSettings } from "./vision-settings-schema";
import { resolveFeatureRoute } from "./provider/routing";
import { AiUnavailableError, isAiUnavailable } from "./provider/types";
import { isPropertyOptedOut } from "./photo-review-opt-out";
import { checkFieldPhotos, type FieldCheckResult } from "./vision";
import { deriveVisionFields } from "./form-fields";
import { loadVisionImage } from "./images";
import { jobFormProperty } from "@/lib/forms/job-form-property";
import { CONFIDENCE_BAND_VALUE, parsePhotoReviewResult, type PhotoObservation, type PhotoReviewResult } from "./photo-review-policy";
import type { VisionFormField } from "./form-fields";

export const photoSubmissionInclude = { media: { orderBy: { id: "asc" as const } }, job: { include: { property: true } } };
export function photoSourceFingerprint(submission: any) {
  return createHash("sha256").update(JSON.stringify({ data: submission.data, media: submission.media.map((m: any) => [m.id, m.fieldId, m.s3Key, m.mediaType]), laundryReady: submission.laundryReady, property: jobFormProperty(submission.data.__templateSchema, submission.job.property) })).digest("hex");
}

/**
 * The settings a queued review keeps: thresholds, the photo model and the
 * photo_compare route at queue time. Processing refuses a review whose
 * provider has since been deselected.
 */
export async function photoReviewSnapshot(settings: VisionSettings): Promise<VisionSettings> {
  const route = await resolveFeatureRoute("photo_compare").catch(() => null);
  return route ? { ...settings, snapshotRoute: { provider: route.provider, model: route.model } } : settings;
}

/** Called inside the successful submission transaction; never calls the provider. */
export async function enqueuePhotoReview(submissionId: string, tx: Prisma.TransactionClient = db) {
  const settings = await getVisionSettings().catch(() => null);
  if (!settings?.comparisonEnabled) return false;
  // Opted-out properties are never queued; an unreadable opt-out list queues nothing (and never blocks the submission).
  const target = await tx.formSubmission.findUnique({ where: { id: submissionId }, select: { job: { select: { propertyId: true } } } }).catch(() => null);
  if (!target?.job?.propertyId || await isPropertyOptedOut(target.job.propertyId, tx).catch(() => true)) return false;
  const snapshot = await photoReviewSnapshot(settings);
  await tx.aiPhotoReview.upsert({ where: { submissionId }, create: { submissionId, settings: snapshot }, update: {} });
  return true;
}

const REVIEW_FAILURE = "Photo analysis could not finish. Check AI configuration and uploaded reference photos, then retry.";
/** A refusal a person can act on keeps its own safe message; anything else stays generic. */
function reviewFailureMessage(error: unknown): string {
  return isAiUnavailable(error) ? error.message : REVIEW_FAILURE;
}

const ASSESSMENT = { meets: "pass", issue: "issue", cannot_tell: "inconclusive" } as const;

/** Stores a field-check answer in the review's per-photo shape (older readers keep working). */
function fieldObservation(mediaId: string, field: VisionFormField, answer: FieldCheckResult["photos"][number], referenceKeys: string[]): PhotoObservation {
  return {
    mediaId, fieldId: field.id, fieldLabel: field.label,
    assessment: ASSESSMENT[answer.outcome], outcome: answer.outcome,
    reason: answer.outcome === "cannot_tell" ? answer.cannotTellReason : null,
    criteria: field.criteria ?? null,
    summary: answer.summary,
    findings: answer.outcome === "issue" ? answer.findings.map((finding, index) => ({
      id: `${mediaId}:${index}`, mediaId, fieldId: field.id, fieldLabel: field.label,
      description: `${finding.criterion}: ${finding.observation}`,
      severity: finding.severity, confidence: CONFIDENCE_BAND_VALUE[finding.confidence], confidenceBand: finding.confidence,
      criterion: finding.criterion, observation: finding.observation,
      referenceMediaKey: finding.referenceId ? referenceKeys[Number(finding.referenceId.slice("reference-".length))] ?? null : null,
      region: finding.region, outcome: "issue" as const,
    })) : [],
  };
}

/** Durable bounded batches. A lease token prevents an expired worker committing over a newer worker. */
export async function processPhotoReviewQueue() {
  const current = await getVisionSettings();
  if (!current.comparisonEnabled) return { processed: 0 };
  const now = new Date();
  await db.aiPhotoReview.updateMany({ where: { status: "RUNNING", leaseUntil: { lt: now }, attempts: { gte: 3 } }, data: { status: "FAILED", error: "Analysis was interrupted repeatedly. Retry when the worker is available.", leaseUntil: null, leaseToken: null } });
  const candidates = await db.aiPhotoReview.findMany({ where: { reviewedAt: null, attempts: { lt: 3 }, OR: [{ status: "PENDING" }, { status: "RUNNING", leaseUntil: { lt: now } }] }, orderBy: { updatedAt: "asc" }, take: 2 });
  let processed = 0;
  for (const candidate of candidates) {
    const token = randomUUID();
    const claim = await db.aiPhotoReview.updateMany({ where: { id: candidate.id, updatedAt: candidate.updatedAt, attempts: { lt: 3 }, reviewedAt: null, OR: [{ status: "PENDING" }, { status: "RUNNING", leaseUntil: { lt: now } }] }, data: { status: "RUNNING", leaseToken: token, leaseUntil: new Date(Date.now() + 15 * 60_000), attempts: { increment: 1 } } });
    if (!claim.count) continue;
    try {
      const settings = visionSettingsSchema.parse(candidate.settings);
      const submission = await db.formSubmission.findUnique({ where: { id: candidate.submissionId }, include: photoSubmissionInclude });
      if (!submission) throw new Error("Submission is unavailable.");
      if (await isPropertyOptedOut(submission.job.propertyId)) throw new AiUnavailableError("DISABLED", "This property is opted out of AI photo review.");
      const fingerprint = photoSourceFingerprint(submission);
      if (candidate.sourceFingerprint && candidate.sourceFingerprint !== fingerprint) throw new Error("Evidence changed. Request a fresh analysis.");
      const data = submission.data as Record<string, unknown>;
      // This snapshot is written by the submit API from the resolved property/job form.
      const fields = deriveVisionFields(data.__templateSchema, data, jobFormProperty(data.__templateSchema, submission.job.property), submission.laundryReady === true);
      const photos = submission.media.filter(media => media.mediaType === "PHOTO");
      const result: PhotoReviewResult = candidate.result ? parsePhotoReviewResult(candidate.result) : { observations: [], totalPhotos: photos.length };
      if (result.totalPhotos !== photos.length || result.observations.some(item => !photos.some(photo => photo.id === item.mediaId && photo.fieldId === item.fieldId))) throw new Error("Stored evidence changed.");
      const done = new Set(result.observations.map(item => item.mediaId));
      const budget = Math.min(current.batchSize, settings.batchSize);
      const remaining = photos.filter(media => !done.has(media.id));
      // One request per field: this run takes up to `budget` photos, grouped by field in form order.
      const byField = new Map<string, typeof remaining>();
      for (const photo of remaining.slice(0, budget)) byField.set(photo.fieldId, [...(byField.get(photo.fieldId) ?? []), photo]);
      const perCall = Math.min(budget, settings.snapshotRoute?.provider === "ollama" || (!settings.snapshotRoute && settings.provider === "ollama") ? 1 : 8);
      for (const [fieldId, fieldPhotos] of Array.from(byField.entries())) {
        if (!(await getVisionSettings()).comparisonEnabled) throw new Error("Analysis disabled.");
        const field = fields.find(item => item.id === fieldId);
        const label = field?.label ?? fieldId;
        if (!field || (!field.referenceKeys.length && !field.criteria)) {
          // Nothing to judge against: not checked, never a pass.
          for (const photo of fieldPhotos) result.observations.push({ mediaId: photo.id, fieldId: photo.fieldId, fieldLabel: label, assessment: "skipped", outcome: "not_checked", reason: "No uploaded reference photo or acceptance criteria for this field.", summary: "No uploaded reference photo or acceptance criteria is available for this field.", findings: [] });
          continue;
        }
        const referenceKeys = field.referenceKeys.slice(0, 4);
        const references = await Promise.all(referenceKeys.map((key, i) => loadVisionImage(key, `reference-${i}`)));
        for (let offset = 0; offset < fieldPhotos.length; offset += perCall) {
          if (offset > 0 && !(await getVisionSettings()).comparisonEnabled) throw new Error("Analysis disabled.");
          const chunk = fieldPhotos.slice(offset, offset + perCall);
          const images = (await Promise.all(chunk.map(photo => loadVisionImage(photo.s3Key, photo.id)))).map((image, index) => ({ ...image, id: chunk[index].id }));
          const checked = await checkFieldPhotos({ fieldId: field.id, fieldLabel: field.label, sectionLabel: field.sectionLabel, criteria: field.criteria ?? null, photos: images, references }, settings, { entity: { type: "FormSubmission", id: submission.id } });
          for (const photo of chunk) {
            const answer = checked.photos.find(item => item.photoId === photo.id);
            if (!answer) throw new Error("Incomplete field check.");
            result.observations.push(fieldObservation(photo.id, field, answer, referenceKeys));
          }
        }
      }
      const fresh = await db.formSubmission.findUnique({ where: { id: submission.id }, include: photoSubmissionInclude });
      if (!fresh || photoSourceFingerprint(fresh) !== fingerprint) throw new Error("Evidence changed during analysis. Request a fresh analysis.");
      const latestSettings = await getVisionSettings();
      if (!latestSettings.comparisonEnabled) throw new Error("Photo comparison was disabled during analysis.");
      parsePhotoReviewResult(result);
      const committed = await db.aiPhotoReview.updateMany({ where: { id: candidate.id, leaseToken: token, status: "RUNNING" }, data: { status: result.observations.length >= photos.length ? "READY" : "PENDING", result: result as any, sourceFingerprint: fingerprint, leaseToken: null, leaseUntil: null, attempts: 0, error: null } });
      if (committed.count) processed++;
    } catch (error) {
      // Never persist provider bodies, signed links or credential-bearing errors.
      await db.aiPhotoReview.updateMany({ where: { id: candidate.id, leaseToken: token, status: "RUNNING" }, data: { status: "FAILED", leaseToken: null, leaseUntil: null, error: reviewFailureMessage(error) } }).catch(() => undefined);
    }
  }
  return { processed };
}
