import { NextRequest, NextResponse } from "next/server";
import { Role, JobStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
import { getSharedCleanerJobDraft, saveSharedCleanerJobDraft, withSharedCleanerJobDraftLock } from "@/lib/cleaner/shared-job-draft";
import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";
import { jobFormRevision } from "@/lib/forms/job-form-revision";
import { getTransactionAppSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { listCleanerJobTasks } from "@/lib/job-tasks/service";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { guestSummaryFromReservation, resolveFinalCheckupItems } from "@/lib/forms/final-checkup";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { publicUrl, resolveS3 } from "@/lib/s3";
import { unionMedia } from "@/lib/cleaner/draft-merge";
import { isTemplateNodeVisible } from "@/lib/forms/visibility";
import { jobFormProperty } from "@/lib/forms/job-form-property";
import { isAllowedUploadContentType } from "@/lib/uploads/validate";
import { isLaundryUpdateEligible } from "@/lib/laundry/eligibility";
import { evidenceDestinationSchema, destinationOf, destinationKey, destinationMedia, setDestinationMedia, removeEvidenceKeys } from "@/lib/cleaner/evidence-destination";

const schema = z.object({ captureId: z.string().uuid(), fieldId: z.string().min(1).max(200),
  legacy: z.boolean().optional(),
  destination: evidenceDestinationSchema.optional(),
  move: z.object({ from: evidenceDestinationSchema, version: z.number().int().nonnegative() }).optional(),
  templateId: z.string().min(1), formRevision: z.string().regex(/^[a-f0-9]{64}$/),
  key: z.string().min(1).max(1000), name: z.string().max(300) });
const json = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = schema.parse(await req.json());
    const identity = cleanerDraftIdentity(session, params.id);
    if (req.headers.get("X-Cleaner-Draft-Identity") !== identity) return json({ error: "Account changed. Reload this job." }, 409);
    // Upload endpoints allocate exactly forms/job/capture/actor/filename. Never accept
    // another actor's object or caller-supplied URLs as an attachment receipt.
    const segments = body.key.split("/");
    const safeKey = !/[\\\u0000-\u0020\u007f]/.test(body.key) && !segments.some(part => !part || part === "." || part === "..");
    const owned = body.legacy
      ? (segments.length === 3 && segments[0] === "forms" && segments[1] === session.user.id)
        || (segments.length === 4 && segments[0] === "jobs" && segments[1] === params.id && segments[2] === session.user.id)
      : segments.length === 5 && segments[0] === "forms" && segments[1] === params.id && segments[2] === body.captureId && segments[3] === session.user.id;
    if (!safeKey || !owned) return json({ error: "Invalid evidence ownership." }, 403);
    const initialAssignment = await db.jobAssignment.findFirst({ where: { jobId: params.id, userId: session.user.id, removedAt: null }, select: { id: true } });
    if (!initialAssignment) return json({ error: "Not assigned to this job." }, 403);
      const { client: s3, bucket: Bucket } = await resolveS3();
      let object;
      try { object = await s3.headObject({ Bucket, Key: body.key }).promise(); }
      catch (error: any) {
        if (error?.code === "NotFound" || error?.statusCode === 404) return json({ error: "Uploaded evidence was not found. Keep the original and retry." }, 409);
        throw error;
      }
      if (!object.ContentLength) return json({ error: "Uploaded evidence could not be verified. Retry attachment." }, 409);
    return await withSharedCleanerJobDraftLock(params.id, async tx => {
      // Hold the job against status transitions until this attachment commits.
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${params.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "JobAssignment" WHERE "jobId" = ${params.id} ORDER BY "id" FOR SHARE`;
      const assigned = await tx.jobAssignment.findFirst({ where: { jobId: params.id, userId: session.user.id, removedAt: null }, select: { id: true } });
      if (!assigned) return json({ error: "Not assigned to this job." }, 403);
      let job = await tx.job.findUnique({ where: { id: params.id }, include: { property: true } });
      if (!job) return json({ error: "Job not found." }, 404);
      if (([JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED] as JobStatus[]).includes(job.status)) {
        return json({ error: "This job is finished. Keep the evidence for office review." }, 409);
      }
      await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${job.propertyId} FOR SHARE`;
      await tx.$queryRaw`SELECT "key" FROM "AppSetting" WHERE "key" = 'app' FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "FormTemplate" WHERE "serviceType"::text = ${job.jobType} ORDER BY "id" FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "JobTask" WHERE "jobId" = ${params.id} ORDER BY "id" FOR SHARE`;
      job = await tx.job.findUnique({ where: { id: params.id }, include: { property: true } });
      if (!job) return json({ error: "Job not found." }, 404);
      const settings = await getTransactionAppSettings(tx);
      const effective = await resolveEffectiveJobForm(job, settings, { database: tx });
      if (!effective.template || !effective.submittable || effective.template.id !== body.templateId) return json({ error: "The form changed. Keep the evidence for review." }, 409);
      const tasks = await listCleanerJobTasks(job.id, tx);
      const meta = parseJobInternalNotes(job.internalNotes);
      const adminTasks = tasks.filter(task => task.source === "ADMIN");
      const finalCheckupItems = resolveFinalCheckupItems(settings, { jobType: job.jobType }, {
        guestSummary: guestSummaryFromReservation(meta.reservationContext),
        adminRequests: (adminTasks.length ? adminTasks : meta.specialRequestTasks ?? []).map(task => ({ id: String(task.id), title: String(task.title ?? "") })),
      });
      const revision = jobFormRevision({ template: effective.template, job, settings, finalCheckupItems,
        canUseNoPhoto: settings.noPhotoExemptCleanerIds.includes(session.user.id) });
      if (revision !== body.formRevision) return json({ error: "The form changed. Keep the evidence for review." }, 409);
      const existing = await getSharedCleanerJobDraft(params.id, tx);
      const state = existing?.state ?? {};
      const target = destinationOf(body);
      const answers = (state.answers ?? {}) as Record<string, unknown>;
      const property = jobFormProperty(effective.template.schema, job.property);
      const laundryReady = (state.laundry as any)?.outcome === "READY_FOR_PICKUP";
      let destination: any = null;
      let destinationVisible = false;
      function visit(node: any, parentVisible = true) {
        if (!node || typeof node !== "object") return;
        const visible = parentVisible && isTemplateNodeVisible(node, answers, property, laundryReady);
        if (target.type === "formField" && node.id === target.fieldId && isUploadFieldType(node.type)) { destination = node; destinationVisible = visible; }
        for (const key of ["sections", "fields", "children"]) if (Array.isArray(node[key])) node[key].forEach((child: any) => visit(child, visible));
      }
      visit(effective.template.schema);
      if (target.type === "bulkPool") { destination = { type: "photo" }; destinationVisible = true; }
      if (target.type === "jobTask" && tasks.some(task => task.id === target.taskId)) { destination = { type: "photo" }; destinationVisible = true; }
      if (target.type === "laundry" && isLaundryUpdateEligible(job, job.property)) { destination = { type: "photo", maxFiles: 1 }; destinationVisible = true; }
      if (target.type === "carryForwardNew") { destination = { type: "photo" }; destinationVisible = true; }
      if (!destination) return json({ error: "This evidence field no longer exists. Keep the file for review." }, 409);
      const receipts = existing?.evidenceReceipts ?? {};
      const kind = object.ContentType?.startsWith("video/") ? "video" : object.ContentType?.startsWith("image/") ? "image" : "file";
      const allowedKind = destination.type === "file" || (destination.mediaMode === "both" ? kind !== "file" : destination.type === "video" ? kind === "video" : kind === "image");
      if (!allowedKind || !isAllowedUploadContentType(object.ContentType, body.key)) return json({ error: "This file type does not match the evidence field. Keep the original for review." }, 409);
      const verifiedMedia = { key: body.key, url: publicUrl(body.key), kind, name: body.name };
      const known = receipts[body.captureId];
      if (body.legacy) {
        if (kind !== "image") return json({ error: "Only saved legacy photos can be acknowledged." }, 409);
        if (Object.entries(receipts).some(([id, receipt]) => id !== body.captureId && receipt.key === body.key)) return json({ error: "This photo already has an evidence receipt. Refresh before assigning it." }, 409);
        if (!known) {
          const pool = destinationMedia(state, { type: "bulkPool" });
          const otherDestinations = [
            ...Object.keys((state.uploads ?? {}) as object).map(fieldId => ({ type: "formField" as const, fieldId })),
            ...Object.keys((state.taskDrafts ?? {}) as object).map(taskId => ({ type: "jobTask" as const, taskId })),
            { type: "laundry" as const }, { type: "carryForwardNew" as const },
          ];
          if (target.type !== "bulkPool" || !pool.some(media => media?.key === body.key && media.kind === "image")
            || otherDestinations.some(destination => destinationMedia(state, destination).some(media => media?.key === body.key))) {
            return json({ error: "This photo must already be saved only in this job's unassigned pool. Refresh before assigning it." }, 409);
          }
        }
      }
      if (known) {
        if (known.detached) return json({ error: "This attachment was explicitly removed. Keep the original for review." }, 409);
        if (known.key !== body.key || known.formRevision !== revision || known.draftIdentity !== identity) return json({ error: "Evidence receipt conflict. Keep the file for review." }, 409);
        const same = destinationKey(destinationOf(known)) === destinationKey(target);
        if (!body.move && !same) return json({ error: "Evidence moved in another tab. Reload its current destination." }, 409);
        if (!body.move || (same && (known.version ?? 0) === body.move.version + 1)) return json({ ok: true, captureId: body.captureId, key: body.key, media: verifiedMedia, destination: target, version: known.version ?? 0 });
        if ((known.version ?? 0) !== body.move.version || destinationKey(destinationOf(known)) !== destinationKey(body.move.from)) return json({ error: "Evidence changed in another tab. Reload before moving it." }, 409);
        if (![destinationOf(known).type, target.type].every(type => type === "bulkPool" || type === "formField")) return json({ error: "Evidence cannot move between these destinations." }, 409);
      }
      else if (body.move) return json({ error: "Attachment must be acknowledged before moving it." }, 409);
      if (!destinationVisible) return json({ error: "This field is not active in the saved job answers. Save the current answers, then retry attachment." }, 409);
      const movedState = removeEvidenceKeys(state, new Set([body.key]));
      const media = unionMedia(destinationMedia(movedState, target), [verifiedMedia]);
      if (Number(destination.maxFiles) > 0 && media.length > Number(destination.maxFiles)) return json({ error: "This field already has its maximum files. Keep this file for review." }, 409);
      const updatedAt = new Date().toISOString();
      await saveSharedCleanerJobDraft(params.id, {
        updatedAt, updatedByUserId: session.user.id, updatedByName: session.user.name ?? "Cleaner",
        editorSessionId: existing?.editorSessionId ?? `evidence:${body.captureId}`,
        evidenceReceipts: { ...receipts, [body.captureId]: { key: body.key, fieldId: body.fieldId, destination: target, version: known ? (known.version ?? 0) + 1 : 0, formRevision: revision, draftIdentity: identity } },
        state: { ...setDestinationMedia(movedState, target, media), updatedAt },
      }, tx);
      return json({ ok: true, captureId: body.captureId, key: body.key, media: verifiedMedia, destination: target, version: known ? (known.version ?? 0) + 1 : 0 });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return json({ error: message }, message === "UNAUTHORIZED" ? 401 : 403);
    if (error instanceof z.ZodError) return json({ error: "Invalid evidence request." }, 400);
    return json({ error: "Evidence attachment was not confirmed. Keep the file and retry." }, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = z.object({ key: z.string().min(1), formRevision: z.string().min(1) }).parse(await req.json());
    const identity = cleanerDraftIdentity(session, params.id);
    if (req.headers.get("X-Cleaner-Draft-Identity") !== identity) return json({ error: "Account changed. Reload this job." }, 409);
    return await withSharedCleanerJobDraftLock(params.id, async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${params.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "JobAssignment" WHERE "jobId" = ${params.id} ORDER BY "id" FOR SHARE`;
      const assigned = await tx.jobAssignment.findFirst({ where: { jobId: params.id, userId: session.user.id, removedAt: null }, select: { id: true } });
      if (!assigned) return json({ error: "Not assigned to this job." }, 403);
      const job = await tx.job.findUnique({ where: { id: params.id }, select: { status: true } });
      if (!job || ([JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED] as JobStatus[]).includes(job.status)) return json({ error: "This job is finished." }, 409);
      const existing = await getSharedCleanerJobDraft(params.id, tx);
      const entries = Object.entries(existing?.evidenceReceipts ?? {}).filter(([, receipt]) => receipt.key === body.key);
      if (!entries.length || !existing) return json({ ok: true, key: body.key }); // Legacy list-only removal.
      if (entries.some(([, receipt]) => receipt.draftIdentity !== identity || receipt.formRevision !== body.formRevision)) return json({ error: "This evidence belongs to another capture context. Ask the office to review it." }, 409);
      const receipts = { ...existing.evidenceReceipts };
      for (const [id, receipt] of entries) {
        receipts[id] = { ...receipt, detached: true };
      }
      await saveSharedCleanerJobDraft(params.id, { ...existing, evidenceReceipts: receipts,
        updatedAt: new Date().toISOString(), state: removeEvidenceKeys(existing.state, new Set([body.key])) }, tx);
      return json({ ok: true, key: body.key });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return json({ error: message }, message === "UNAUTHORIZED" ? 401 : 403);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "Invalid evidence removal request." }, 400);
    return json({ error: "Evidence removal was not confirmed. Retry." }, 500);
  }
}
