import "server-only";
/**
 * Office edits to a submitted form (PATCH /api/admin/form-submissions/[id]),
 * used by the Forms page's submission view and the job pages.
 *
 * The classic implementation overwrote the answers with no history and deleted
 * removed photos from storage. Both were existing problems; now:
 * - an answer edit writes FORM_SUBMISSION_EDITED with the before and after of
 *   every changed answer (and laundry field), so the original stays as history;
 * - internal fields (keys starting "__": the stored effective form, warnings,
 *   effects) cannot be changed;
 * - "remove media" takes the photo off the submission but never deletes the
 *   stored original: the full media row is kept as a tombstone in
 *   FORM_SUBMISSION_MEDIA_REMOVED and can be restored;
 * - added media must pass the upload-ownership rule (the caller's own upload,
 *   a cleaner on the job, or an office account), audited as
 *   FORM_SUBMISSION_MEDIA_ADDED.
 */
import { LaundryOutcome, MediaType, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { generateJobReport } from "@/lib/reports/generator";
import { findForeignUploadKeys } from "@/lib/uploads/ownership-server";
import { FOREIGN_UPLOAD_MESSAGE } from "@/lib/uploads/ownership";

export const SUBMISSION_EDIT_ACTIONS = {
  edited: "FORM_SUBMISSION_EDITED",
  mediaRemoved: "FORM_SUBMISSION_MEDIA_REMOVED",
  mediaAdded: "FORM_SUBMISSION_MEDIA_ADDED",
  mediaRestored: "FORM_SUBMISSION_MEDIA_RESTORED",
} as const;

const mediaSchema = z.object({
  url: z.string().trim().min(1),
  s3Key: z.string().trim().min(1),
  fieldId: z.string().trim().min(1),
  mimeType: z.string().trim().optional().nullable(),
  label: z.string().trim().optional().nullable(),
});

export const submissionPatchSchema = z.object({
  data: z.record(z.any()).optional(),
  laundryReady: z.boolean().optional().nullable(),
  laundryOutcome: z.nativeEnum(LaundryOutcome).optional().nullable(),
  bagLocation: z.string().trim().optional().nullable(),
  addMediaUrls: z.array(mediaSchema).max(50).optional(),
  deleteMediaIds: z.array(z.string().trim().min(1)).max(100).optional(),
  /** Audit ids of FORM_SUBMISSION_MEDIA_REMOVED rows to put back. */
  restoreMediaAuditIds: z.array(z.string().trim().min(1)).max(100).optional(),
});

export type SubmissionPatch = z.infer<typeof submissionPatchSchema>;

export class SubmissionEditError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type MediaRow = Prisma.SubmissionMediaGetPayload<object>;

export type RemovedMediaTombstone = {
  id: string; fieldId: string; mediaType: MediaType; url: string; s3Key: string;
  originalUrl: string | null; originalS3Key: string | null; annotatedUrl: string | null; annotatedS3Key: string | null;
  annotationData: Prisma.JsonValue | null; sizeBytes: number | null; mimeType: string | null; label: string | null; createdAt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The answers that change, as before/after pairs. Throws on an internal key. */
export function answerChanges(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (same(existing[key], value)) continue;
    if (key.startsWith("__")) throw new SubmissionEditError(400, "Internal fields of a submission cannot be edited.");
    before[key] = existing[key] ?? null;
    after[key] = value ?? null;
  }
  return { before, after, keys: Object.keys(after) };
}

function detectMediaType(mimeType: string | null | undefined): MediaType {
  return String(mimeType ?? "").toLowerCase().startsWith("video/") ? MediaType.VIDEO : MediaType.PHOTO;
}

function safeMediaUrl(url: string, key: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
  } catch {
    // fall through to the key's own public address
  }
  return publicUrl(key);
}

export function tombstoneOf(media: MediaRow): RemovedMediaTombstone {
  return {
    id: media.id, fieldId: media.fieldId, mediaType: media.mediaType, url: media.url, s3Key: media.s3Key,
    originalUrl: media.originalUrl, originalS3Key: media.originalS3Key, annotatedUrl: media.annotatedUrl, annotatedS3Key: media.annotatedS3Key,
    annotationData: media.annotationData ?? null, sizeBytes: media.sizeBytes, mimeType: media.mimeType, label: media.label, createdAt: media.createdAt.toISOString(),
  };
}

function laundryChanges(existing: { laundryReady: boolean | null; laundryOutcome: LaundryOutcome | null; bagLocation: string | null }, patch: SubmissionPatch) {
  const next = {
    laundryReady: patch.laundryReady !== undefined ? patch.laundryReady : existing.laundryReady,
    laundryOutcome: patch.laundryOutcome !== undefined ? patch.laundryOutcome || null : existing.laundryOutcome,
    bagLocation: patch.bagLocation !== undefined ? patch.bagLocation || null : existing.bagLocation,
  };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of ["laundryReady", "laundryOutcome", "bagLocation"] as const) {
    if (!same(existing[key], next[key])) {
      before[key] = existing[key];
      after[key] = next[key];
    }
  }
  return { next, before, after };
}

async function tombstonesToRestore(submissionId: string, auditIds: readonly string[], present: ReadonlySet<string>): Promise<RemovedMediaTombstone[]> {
  if (auditIds.length === 0) return [];
  const rows = await db.auditLog.findMany({ where: { id: { in: [...auditIds] }, action: SUBMISSION_EDIT_ACTIONS.mediaRemoved, entity: "FormSubmission", entityId: submissionId }, select: { after: true } });
  if (rows.length !== new Set(auditIds).size) throw new SubmissionEditError(404, "A removed photo to restore was not found on this submission.");
  return rows.map((row) => (row.after as { media: RemovedMediaTombstone }).media).filter((media) => media && !present.has(media.id));
}

/** Applies an office edit; returns nothing (the route re-reads the submission). */
export async function editFormSubmission(actor: { id: string }, submissionId: string, input: unknown): Promise<void> {
  const patch = submissionPatchSchema.parse(input);
  const existing = await db.formSubmission.findUnique({ where: { id: submissionId }, include: { media: true } });
  if (!existing) throw new SubmissionEditError(404, "Submission not found.");

  const data = asRecord(existing.data);
  const answers = patch.data !== undefined ? answerChanges(data, patch.data) : { before: {}, after: {}, keys: [] as string[] };
  const laundry = laundryChanges(existing, patch);
  const deleteIds = new Set(patch.deleteMediaIds ?? []);
  const removed = existing.media.filter((media) => deleteIds.has(media.id));
  const added = patch.addMediaUrls ?? [];
  if (added.length) {
    const foreign = await findForeignUploadKeys({ keys: added.map((media) => media.s3Key), callerId: actor.id, jobId: existing.jobId });
    if (foreign.length) throw new SubmissionEditError(403, FOREIGN_UPLOAD_MESSAGE);
  }
  const restore = await tombstonesToRestore(submissionId, patch.restoreMediaAuditIds ?? [], new Set(existing.media.map((media) => media.id)));
  const laundryChanged = Object.keys(laundry.after).length > 0;
  if (!answers.keys.length && !laundryChanged && !removed.length && !added.length && !restore.length) return;

  await db.$transaction(async (tx) => {
    if (answers.keys.length || laundryChanged) {
      await tx.formSubmission.update({
        where: { id: submissionId },
        data: {
          ...(answers.keys.length ? { data: { ...data, ...answers.after } as Prisma.InputJsonValue } : {}),
          laundryReady: laundry.next.laundryReady,
          laundryOutcome: laundry.next.laundryOutcome,
          bagLocation: laundry.next.bagLocation,
        },
      });
      await tx.auditLog.create({ data: {
        userId: actor.id, jobId: existing.jobId, action: SUBMISSION_EDIT_ACTIONS.edited, entity: "FormSubmission", entityId: submissionId,
        before: { answers: answers.before, laundry: laundry.before } as Prisma.InputJsonValue,
        after: { answers: answers.after, laundry: laundry.after, changedKeys: answers.keys } as Prisma.InputJsonValue,
      } });
    }
    for (const media of removed) {
      // The stored original is kept; only the link from this submission goes.
      await tx.auditLog.create({ data: {
        userId: actor.id, jobId: existing.jobId, action: SUBMISSION_EDIT_ACTIONS.mediaRemoved, entity: "FormSubmission", entityId: submissionId,
        after: { media: tombstoneOf(media), originalKept: true } as unknown as Prisma.InputJsonValue,
      } });
    }
    if (removed.length) await tx.submissionMedia.deleteMany({ where: { submissionId, id: { in: removed.map((media) => media.id) } } });
    for (const media of restore) {
      await tx.submissionMedia.create({ data: {
        id: media.id, submissionId, fieldId: media.fieldId, mediaType: media.mediaType, url: media.url, s3Key: media.s3Key,
        originalUrl: media.originalUrl, originalS3Key: media.originalS3Key, annotatedUrl: media.annotatedUrl, annotatedS3Key: media.annotatedS3Key,
        annotationData: media.annotationData ?? undefined, sizeBytes: media.sizeBytes, mimeType: media.mimeType, label: media.label, createdAt: new Date(media.createdAt),
      } });
    }
    if (restore.length) {
      await tx.auditLog.create({ data: {
        userId: actor.id, jobId: existing.jobId, action: SUBMISSION_EDIT_ACTIONS.mediaRestored, entity: "FormSubmission", entityId: submissionId,
        after: { mediaIds: restore.map((media) => media.id) } as Prisma.InputJsonValue,
      } });
    }
    if (added.length) {
      const rows = added.map((media) => ({
        submissionId, fieldId: media.fieldId, mediaType: detectMediaType(media.mimeType),
        url: safeMediaUrl(media.url, media.s3Key), s3Key: media.s3Key, mimeType: media.mimeType || null, label: media.label || null,
      }));
      await tx.submissionMedia.createMany({ data: rows });
      await tx.auditLog.create({ data: {
        userId: actor.id, jobId: existing.jobId, action: SUBMISSION_EDIT_ACTIONS.mediaAdded, entity: "FormSubmission", entityId: submissionId,
        after: { media: rows.map((row) => ({ fieldId: row.fieldId, s3Key: row.s3Key, mediaType: row.mediaType, label: row.label })) } as Prisma.InputJsonValue,
      } });
    }
  });
  generateJobReport(existing.jobId).catch(() => {});
}
