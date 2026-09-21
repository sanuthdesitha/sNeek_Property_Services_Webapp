import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getVisionSettings } from "./vision-settings";
import { visionSettingsSchema } from "./vision-settings-schema";
import { compareReferencePhotos } from "./vision";
import { deriveVisionFields } from "./form-fields";
import { loadVisionImage } from "./images";
import { jobFormProperty } from "@/lib/forms/job-form-property";
import { parsePhotoReviewResult, type PhotoObservation, type PhotoReviewResult } from "./photo-review-policy";

export const photoSubmissionInclude = { media: { orderBy: { id: "asc" as const } }, job: { include: { property: true } } };
export function photoSourceFingerprint(submission: any) {
  return createHash("sha256").update(JSON.stringify({ data: submission.data, media: submission.media.map((m: any) => [m.id, m.fieldId, m.s3Key, m.mediaType]), laundryReady: submission.laundryReady, property: jobFormProperty(submission.data.__templateSchema, submission.job.property) })).digest("hex");
}

/** Called inside the successful submission transaction; never calls the provider. */
export async function enqueuePhotoReview(submissionId: string, tx: Prisma.TransactionClient = db) {
  const settings = await getVisionSettings().catch(() => null);
  if (!settings?.comparisonEnabled) return false;
  await tx.aiPhotoReview.upsert({ where: { submissionId }, create: { submissionId, settings }, update: {} });
  return true;
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
      const fingerprint = photoSourceFingerprint(submission);
      if (candidate.sourceFingerprint && candidate.sourceFingerprint !== fingerprint) throw new Error("Evidence changed. Request a fresh analysis.");
      const data = submission.data as Record<string, unknown>;
      // This snapshot is written by the submit API from the resolved property/job form.
      const fields = deriveVisionFields(data.__templateSchema, data, jobFormProperty(data.__templateSchema, submission.job.property), submission.laundryReady === true);
      const photos = submission.media.filter(media => media.mediaType === "PHOTO");
      const result: PhotoReviewResult = candidate.result ? parsePhotoReviewResult(candidate.result) : { observations: [], totalPhotos: photos.length };
      if (result.totalPhotos !== photos.length || result.observations.some(item => !photos.some(photo => photo.id === item.mediaId && photo.fieldId === item.fieldId))) throw new Error("Stored evidence changed.");
      const done = new Set(result.observations.map(item => item.mediaId));
      const batch = photos.filter(media => !done.has(media.id)).slice(0, Math.min(current.batchSize, settings.batchSize));
      for (const photo of batch) {
        if (!(await getVisionSettings()).comparisonEnabled) throw new Error("Analysis disabled.");
        const field = fields.find(item => item.id === photo.fieldId);
        let observation: PhotoObservation;
        if (!field?.referenceKeys.length) {
          observation = { mediaId: photo.id, fieldId: photo.fieldId, fieldLabel: field?.label ?? photo.fieldId, assessment: "skipped", summary: "No uploaded reference photo is available for this field.", findings: [] };
        } else {
          const references = await Promise.all(field.referenceKeys.map((key, i) => loadVisionImage(key, `reference-${i}`)));
          const image = await loadVisionImage(photo.s3Key, photo.id);
          const assessment = await compareReferencePhotos({ references, submission: image, context: `${field.sectionLabel}: ${field.label}` }, settings);
          observation = { mediaId: photo.id, fieldId: field.id, fieldLabel: field.label, assessment: assessment.assessment, summary: assessment.summary,
            findings: assessment.assessment === "issue" ? assessment.issues.map((issue, index) => ({ id: `${photo.id}:${index}`, mediaId: photo.id, fieldId: field.id, fieldLabel: field.label, description: issue.description, severity: issue.severity, confidence: Math.min(issue.confidence, assessment.confidence) })) : [] };
        }
        result.observations.push(observation);
      }
      const fresh = await db.formSubmission.findUnique({ where: { id: submission.id }, include: photoSubmissionInclude });
      if (!fresh || photoSourceFingerprint(fresh) !== fingerprint) throw new Error("Evidence changed during analysis. Request a fresh analysis.");
      const latestSettings = await getVisionSettings();
      if (!latestSettings.comparisonEnabled) throw new Error("Photo comparison was disabled during analysis.");
      parsePhotoReviewResult(result);
      const committed = await db.aiPhotoReview.updateMany({ where: { id: candidate.id, leaseToken: token, status: "RUNNING" }, data: { status: result.observations.length >= photos.length ? "READY" : "PENDING", result: result as any, sourceFingerprint: fingerprint, leaseToken: null, leaseUntil: null, attempts: 0, error: null } });
      if (committed.count) processed++;
    } catch {
      // Never persist provider bodies, signed links or credential-bearing errors.
      await db.aiPhotoReview.updateMany({ where: { id: candidate.id, leaseToken: token, status: "RUNNING" }, data: { status: "FAILED", leaseToken: null, leaseUntil: null, error: "Photo analysis could not finish. Check AI configuration and uploaded reference photos, then retry." } }).catch(() => undefined);
    }
  }
  return { processed };
}
