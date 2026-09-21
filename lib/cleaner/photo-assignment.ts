import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadVisionImage } from "@/lib/ai/images";
import { getVisionProviderConfiguration } from "@/lib/ai/config";
import { predictPropertyRecognition } from "@/lib/ai/property-photo-model";
import { getHistoricalAssignmentExamples } from "@/lib/ai/historical-assignment-examples";
import { deriveVisionFields } from "@/lib/ai/form-fields";
import { cleanerDraftIdentity } from "./draft-identity";
import { getSharedCleanerJobDraft, withSharedCleanerJobDraftLock } from "./shared-job-draft";
import { destinationOf, destinationMedia } from "./evidence-destination";
import { getTransactionAppSettings } from "@/lib/settings";
import { resolveEffectiveJobForm } from "@/lib/forms/resolve-effective-job-form";
import { jobFormRevision } from "@/lib/forms/job-form-revision";
import { jobFormProperty } from "@/lib/forms/job-form-property";


import { listCleanerJobTasks } from "@/lib/job-tasks/service";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { guestSummaryFromReservation, resolveFinalCheckupItems } from "@/lib/forms/final-checkup";

import { assignPhotosToFields, type VisionImage } from "@/lib/ai/vision";
import { getVisionSettings } from "@/lib/ai/vision-settings";

export const photoAssignmentSchema = z.object({
  templateId: z.string().min(1).max(200), formRevision: z.string().regex(/^[a-f0-9]{64}$/),
  photos: z.array(z.object({ captureId: z.string().uuid(), key: z.string().min(1).max(1000), version: z.number().int().nonnegative() }).strict()).min(1).max(8),
}).strict();
type Input = z.infer<typeof photoAssignmentSchema>;
type Session = { user: { id: string }; impersonation?: { actorId: string } | null };
type Field = { id: string; label: string; sectionLabel: string; referenceKeys: string[]; capacity: number };
export class PhotoAssignmentError extends Error { constructor(public status: number, message: string, public maxBatchSize?: number) { super(message); } }
const fail = (status: number, message: string): never => { throw new PhotoAssignmentError(status, message); };

async function snapshot(jobId: string, session: Session, input: Input, identity: string, historicalEnabled: boolean, dedicatedEnabled: boolean) {
  return withSharedCleanerJobDraftLock(jobId, async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${jobId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "JobAssignment" WHERE "jobId" = ${jobId} ORDER BY "id" FOR SHARE`;
    const assignment = await tx.jobAssignment.findFirst({ where: { jobId, userId: session.user.id, removedAt: null }, select: { id: true } });
    if (!assignment) fail(403, "Not assigned to this job.");
    let job = await tx.job.findUnique({ where: { id: jobId }, include: { property: true } });
    if (!job) fail(404, "Job not found.");
    if (!["IN_PROGRESS", "PAUSED"].includes(job!.status)) fail(409, "Photo assignment is available only while this job is active.");
    await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${job!.propertyId} FOR SHARE`;
    await tx.$queryRaw`SELECT "key" FROM "AppSetting" WHERE "key" = 'app' FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "FormTemplate" WHERE "serviceType"::text = ${job!.jobType} ORDER BY "id" FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "JobTask" WHERE "jobId" = ${jobId} ORDER BY "id" FOR SHARE`;
    job = await tx.job.findUnique({ where: { id: jobId }, include: { property: true } });
    if (!job) fail(404, "Job not found.");
    const settings = await getTransactionAppSettings(tx);
    const effective = await resolveEffectiveJobForm(job!, settings, { database: tx });
    if (!effective.template || !effective.submittable || effective.template.id !== input.templateId) fail(409, "The form changed. Refresh before requesting suggestions.");
    const tasks = await listCleanerJobTasks(jobId, tx);
    const meta = parseJobInternalNotes(job!.internalNotes);
    const adminTasks = tasks.filter(task => task.source === "ADMIN");
    const finalCheckupItems = resolveFinalCheckupItems(settings, { jobType: job!.jobType }, { guestSummary: guestSummaryFromReservation(meta.reservationContext), adminRequests: (adminTasks.length ? adminTasks : meta.specialRequestTasks ?? []).map(task => ({ id: String(task.id), title: String(task.title ?? "") })) });
    const revision = jobFormRevision({ template: effective.template!, job: job!, settings, finalCheckupItems, canUseNoPhoto: settings.noPhotoExemptCleanerIds.includes(session.user.id) });
    if (revision !== input.formRevision) fail(409, "The form changed. Refresh before requesting suggestions.");
    const draft = await getSharedCleanerJobDraft(jobId, tx);
    const state = draft?.state ?? {};
    const pool = destinationMedia(state, { type: "bulkPool" });
    for (const photo of input.photos) {
      const receipt = draft?.evidenceReceipts?.[photo.captureId];
      if (!receipt || receipt.detached || receipt.key !== photo.key || receipt.formRevision !== revision || receipt.draftIdentity !== identity || (receipt.version ?? 0) !== photo.version || destinationOf(receipt).type !== "bulkPool" || !pool.some(media => media.key === photo.key && media.kind === "image")) fail(409, "A photo is no longer in this unassigned pool. Refresh and try again.");
    }
    const property = jobFormProperty(effective.template!.schema, job!.property);
    const fields: Field[] = deriveVisionFields(effective.template!.schema, (state.answers ?? {}) as Record<string, unknown>, property, (state.laundry as any)?.outcome === "READY_FOR_PICKUP")
      .filter(field => field.imageCapable).map(field => ({ ...field, capacity: field.maxFiles ? Math.max(0, field.maxFiles - destinationMedia(state, { type: "formField", fieldId: field.id }).length) : 8 })).filter(field => field.capacity > 0);
    if (fields.length > 60 || new Set(fields.map(field => field.id)).size !== fields.length) fail(409, "This form needs manual photo assignment.");
    const historicalMemory = historicalEnabled ? await getHistoricalAssignmentExamples({ propertyId: job!.propertyId, currentJobId: jobId, fields, maxImages: 20 - input.photos.length }, tx) : { examples: [], exclusionsFingerprint: "disabled" };
    const historicalExamples = historicalMemory.examples;
    const recognitionModel = dedicatedEnabled ? await tx.aiPropertyModelTraining.findUnique({ where: { propertyId: job!.propertyId }, select: { status: true, desiredRevision: true, trainedRevision: true, modelVersion: true } }) : null;
    return { fields, recognitionModel, propertyId: job!.propertyId, historicalExamples, fingerprint: createHash("sha256").update(JSON.stringify({ propertyId: job!.propertyId, revision, fields, state, photos: input.photos, historicalExamples, exclusionsFingerprint: historicalMemory.exclusionsFingerprint, recognitionModel })).digest("hex") };
  });
}

export async function proposePhotoAssignments(jobId: string, session: Session, raw: unknown, headerIdentity: string | null) {
  const input = photoAssignmentSchema.parse(raw);
  const identity = cleanerDraftIdentity(session, jobId);
  if (headerIdentity !== identity) fail(409, "Account changed. Reload this job.");
  if (session.impersonation) fail(403, "Photo analysis is unavailable while impersonating.");
  if (new Set(input.photos.map(photo => photo.key)).size !== input.photos.length || new Set(input.photos.map(photo => photo.captureId)).size !== input.photos.length) fail(400, "Choose each photo only once.");
  for (const photo of input.photos) {
    const parts = photo.key.split("/");
    if (parts.length !== 5 || parts[0] !== "forms" || parts[1] !== jobId || parts[2] !== photo.captureId || parts[3] !== session.user.id || !parts[4] || parts.some(part => part === "." || part === "..")) fail(403, "Invalid photo ownership.");
  }
  const config = await getVisionSettings();
  const historicalEnabled = config.historicalAssignmentExamplesEnabled !== false;
  const dedicatedEnabled = config.dedicatedRecognitionEnabled === true;
  const initial = await snapshot(jobId, session, input, identity, historicalEnabled, dedicatedEnabled);
  if (!config.assignmentEnabled) fail(409, "AI photo assignment is not enabled. Assign photos manually.");
  if (input.photos.length > config.batchSize) throw new PhotoAssignmentError(400, `Choose no more than ${config.batchSize} photos for one analysis.`, config.batchSize);
  if (!initial.fields.length) fail(409, "No available image fields in this form. Assign photos manually.");
  let bytes = 0, images = 0;
  async function image(key: string, id: string): Promise<VisionImage> {
    const result = await loadVisionImage(key, id);
    bytes += Buffer.byteLength(result.data, "base64"); images++;
    if (bytes > 20 * 1024 * 1024 || images > 20) fail(400, "This batch is too large. Choose fewer photos.");
    return result;
  }
  const photos: VisionImage[] = [];
  for (const photo of input.photos) photos.push(await image(photo.key, photo.captureId));
  const fields = initial.fields.map(field => ({ id: field.id, label: field.label, sectionLabel: field.sectionLabel, referenceImages: [] as VisionImage[], historicalExamples: [] as VisionImage[] }));
  // Spread the bounded image budget across destinations and both kinds of examples.
  // Historical photos identify the location; they are never cleanliness standards.
  const plans = initial.fields.map((field, index) => {
    const refs = field.referenceKeys.map(key => ({ key, historical: false }));
    const history = initial.historicalExamples.filter(example => example.fieldId === field.id).map(example => ({ key: example.storageKey, historical: true }));
    const plan: { key: string; historical: boolean }[] = [];
    for (let i = 0; i < Math.max(refs.length, history.length); i++) {
      for (const item of index % 2 ? [history[i], refs[i]] : [refs[i], history[i]]) if (item) plan.push(item);
    }
    return plan;
  });
  for (let round = 0; images < 20 && plans.some(plan => plan.length > round); round++) {
    for (let index = 0; index < fields.length && images < 20; index++) {
      const example = plans[index][round]; if (!example) continue;
      const target = example.historical ? fields[index].historicalExamples : fields[index].referenceImages;
      target.push(await image(example.key, (example.historical ? "history" : "ref") + "-" + fields[index].id + "-" + target.length));
    }
  }
  // Recheck before provider disclosure and again before returning proposals.
  if ((await snapshot(jobId, session, input, identity, historicalEnabled, dedicatedEnabled)).fingerprint !== initial.fingerprint) fail(409, "Job evidence changed. Refresh before analysis.");
  if (((await getVisionSettings()).historicalAssignmentExamplesEnabled !== false) !== historicalEnabled) fail(409, "Photo matching settings changed. Request fresh suggestions.");
  const model = initial.recognitionModel;
  const latestConfig = await getVisionSettings();
  const recognized = dedicatedEnabled && latestConfig.dedicatedRecognitionEnabled && model?.status === "READY" && model.modelVersion && model.trainedRevision && model.trainedRevision === model.desiredRevision
    ? await predictPropertyRecognition({ propertyId: initial.propertyId, revision: model.trainedRevision, modelVersion: model.modelVersion, photos, fields: fields.map(({ id, label, sectionLabel }) => ({ id, label, sectionLabel })) }) : null;
  const accepted = recognized?.assignments.filter(item => item.fieldId !== null && item.confidence >= config.minConfidence) ?? [];
  const remainingPhotos = photos.filter(photo => !accepted.some(item => item.photoId === photo.id));
  const fallback = remainingPhotos.length && getVisionProviderConfiguration(config.provider).configured ? await assignPhotosToFields({ photos: remainingPhotos, fields }) : { assignments: remainingPhotos.map(photo => ({ photoId: photo.id, fieldId: null, confidence: 0, reason: "No confident model match and vision fallback is unavailable. Assign this photo manually." })) };
  const result = { assignments: [...accepted, ...fallback.assignments] };
  if (accepted.length && !(await getVisionSettings()).dedicatedRecognitionEnabled) fail(409, "Photo matching settings changed. Request fresh suggestions.");
  if (((await getVisionSettings()).historicalAssignmentExamplesEnabled !== false) !== historicalEnabled) fail(409, "Photo matching settings changed. Request fresh suggestions.");
  if ((await snapshot(jobId, session, input, identity, historicalEnabled, dedicatedEnabled)).fingerprint !== initial.fingerprint) fail(409, "Job evidence changed during analysis. Request fresh suggestions.");
  const output = z.object({ assignments: z.array(z.object({ photoId: z.string(), fieldId: z.string().nullable(), confidence: z.number().min(0).max(1), reason: z.string().max(1000) }).strict()).max(8) }).safeParse(result);
  if (!output.success) fail(502, "The photo suggestions could not be verified. Assign manually or try again.");
  const parsed = output.data!;
  if (parsed.assignments.length !== photos.length || new Set(parsed.assignments.map(item => item.photoId)).size !== photos.length || parsed.assignments.some(item => !photos.some(photo => photo.id === item.photoId) || (item.fieldId !== null && !initial.fields.some(field => field.id === item.fieldId)))) fail(502, "The photo suggestions could not be verified. Assign manually or try again.");
  const remaining = new Map(initial.fields.map(field => [field.id, field.capacity]));
  const proposals = input.photos.map(photo => {
    const suggestion = parsed.assignments.find(item => item.photoId === photo.captureId)!;
    let fieldId = suggestion.confidence >= config.minConfidence ? suggestion.fieldId : null;
    if (fieldId && !remaining.get(fieldId)) fieldId = null;
    if (fieldId) remaining.set(fieldId, remaining.get(fieldId)! - 1);
    return { ...photo, fieldId, confidence: suggestion.confidence, reason: fieldId ? suggestion.reason : "No confident available destination. Assign this photo manually." };
  });
  return { templateId: input.templateId, formRevision: input.formRevision, draftIdentity: identity, minConfidence: config.minConfidence, proposals };
}
