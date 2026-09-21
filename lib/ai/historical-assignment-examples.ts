import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { photoMemoryKey, parsePhotoMemoryExclusions } from "./photo-memory-settings";

type Field = { id: string; label: string; sectionLabel: string };
export type HistoricalAssignmentExample = {
  fieldId: string; fieldLabel: string; sectionLabel: string; mediaId: string; storageKey: string;
  sourceJobId: string; sourceSubmissionId: string; submittedAt: Date;
};
const statuses = ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] as const;
const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const labelKey = (field: Field) => JSON.stringify([normalize(field.sectionLabel), normalize(field.label)]);

// Submitted media must resolve to an actual image-capable field in its immutable
// template snapshot. Pool/task keys and arbitrary caller labels are never examples.
function submittedFields(schema: unknown): Field[] {
  const fields: Field[] = [];
  function visit(node: any, section = "", depth = 0) {
    if (!node || typeof node !== "object" || depth > 20 || fields.length > 500) return;
    const sectionLabel = Array.isArray(node.fields) ? String(node.title ?? node.label ?? section).slice(0, 300) : section;
    if (typeof node.id === "string" && typeof node.type === "string" && isUploadFieldType(node.type)
      && (node.type === "file" || node.mediaMode === "both" || (node.type === "photo" && node.mediaMode !== "video"))) {
      fields.push({ id: node.id, label: String(node.label ?? node.id).slice(0, 300), sectionLabel });
    }
    for (const key of ["sections", "fields", "children"]) if (Array.isArray(node[key])) node[key].forEach((child: unknown) => visit(child, sectionLabel, depth + 1));
  }
  visit(schema);
  return fields;
}

/** Location examples only, never cleanliness references. Caller must supply the
 * property/job pair from its authorized job snapshot, never from request JSON. */
export async function getHistoricalAssignmentExamples(input: {
  propertyId: string; currentJobId: string | null; fields: Field[]; maxImages: number; purpose?: "assignment" | "training";
}, database: Pick<Prisma.TransactionClient, "formSubmission" | "appSetting"> = db): Promise<{ examples: HistoricalAssignmentExample[]; exclusionsFingerprint: string }> {
  const training = input.purpose === "training";
  const budget = Math.min(training ? 200 : 20, Math.max(0, Math.floor(input.maxImages)));
  const perFieldLimit = training ? 20 : 2;
  if (!input.propertyId || (!training && !input.currentJobId) || input.fields.length > 100 || new Set(input.fields.map(field => field.id)).size !== input.fields.length) throw new Error("Invalid historical example scope");
  const memory = await database.appSetting.findUnique({ where: { key: photoMemoryKey(input.propertyId) } });
  const exclusions = memory ? parsePhotoMemoryExclusions(memory.value) : [];
  const excluded = new Set(exclusions);
  const exclusionsFingerprint = createHash("sha256").update(JSON.stringify(Array.from(excluded).sort())).digest("hex");
  if (!Number.isFinite(budget) || !budget || !input.fields.length) return { examples: [], exclusionsFingerprint };
  const submissions = await database.formSubmission.findMany({
    where: { ...(input.currentJobId ? { jobId: { not: input.currentJobId } } : {}), job: { propertyId: input.propertyId, status: { in: [...statuses] } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    select: { id: true, jobId: true, createdAt: true, data: true,
      job: { select: { propertyId: true, status: true } },
      media: { where: { mediaType: "PHOTO" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 120,
        select: { id: true, fieldId: true, s3Key: true, mediaType: true } },
    },
  });
  const seenJobs = new Set<string>();
  const seenKeys = new Set<string>();
  const candidates = new Map(input.fields.map(field => [field.id, [] as HistoricalAssignmentExample[]]));
  for (const submission of submissions) {
    if (submission.jobId === input.currentJobId || submission.job.propertyId !== input.propertyId || !(statuses as readonly string[]).includes(submission.job.status) || seenJobs.has(submission.jobId)) continue;
    seenJobs.add(submission.jobId); // An empty/latest submission invalidates that job's older examples.
    const data = submission.data as Record<string, unknown> | null;
    const historical = submittedFields(data?.__templateSchema);
    const usedFields = new Set<string>();
    for (const media of submission.media) {
      if (excluded.has(media.id) || media.mediaType !== "PHOTO" || !media.s3Key.startsWith(`forms/${submission.jobId}/`) || /[\\\u0000-\u0020]/.test(media.s3Key) || media.s3Key.split("/").some(part => !part || part === "." || part === "..") || seenKeys.has(media.s3Key)) continue;
      const sourceFields = historical.filter(field => field.id === media.fieldId);
      if (sourceFields.length !== 1) continue;
      const source = sourceFields[0];
      const key = labelKey(source);
      let target = input.fields.find(field => field.id === source.id);
      // Reused IDs with a changed room/label are not evidence of the same location.
      if (target && labelKey(target) !== key) continue;
      if (!target) {
        if (!normalize(source.label) || !normalize(source.sectionLabel) || historical.filter(field => labelKey(field) === key).length !== 1) continue;
        const matches = input.fields.filter(field => labelKey(field) === key);
        if (matches.length !== 1) continue;
        target = matches[0];
      }
      const examples = candidates.get(target.id)!;
      if (examples.length >= perFieldLimit || usedFields.has(target.id)) continue;
      examples.push({ fieldId: target.id, fieldLabel: target.label, sectionLabel: target.sectionLabel, mediaId: media.id, storageKey: media.s3Key, sourceJobId: submission.jobId, sourceSubmissionId: submission.id, submittedAt: submission.createdAt });
      usedFields.add(target.id); seenKeys.add(media.s3Key);
    }
  }
  // Fairly distribute the budget across rooms before adding a second example.
  const result: HistoricalAssignmentExample[] = [];
  for (let round = 0; round < perFieldLimit; round++) for (const field of input.fields) {
    const example = candidates.get(field.id)?.[round];
    if (example && result.length < budget) result.push(example);
  }
  return { examples: result, exclusionsFingerprint };
}

/** Canonical labels come from the most recent submitted form at this property.
 * The worker must separately check its feature toggle and property authorization. */
export async function readPropertyTrainingExamples(propertyId: string, database: Pick<Prisma.TransactionClient, "formSubmission" | "appSetting"> = db) {
  if (!propertyId) throw new Error("Invalid training property");
  const latest = await database.formSubmission.findFirst({ where: { job: { propertyId, status: { in: [...statuses] } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { data: true } });
  const data = latest?.data as Record<string, unknown> | undefined;
  const fields = submittedFields(data?.__templateSchema);
  const labels = fields.filter(field => fields.filter(other => other.id === field.id).length === 1).slice(0, 100);
  const result = await getHistoricalAssignmentExamples({ propertyId, currentJobId: null, fields: labels, maxImages: 200, purpose: "training" }, database);
  const revision = createHash("sha256").update(JSON.stringify({ propertyId, labels, ...result })).digest("hex");
  return { examples: result.examples, labels, revision };
}
