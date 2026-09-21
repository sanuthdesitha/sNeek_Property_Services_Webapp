import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getHistoricalSubmissionFields, resolveHistoricalMediaField } from "./historical-media";
import { photoMemoryKey, parsePhotoMemoryExclusions } from "./photo-memory-settings";

type Field = { id: string; label: string; sectionLabel: string };
export type HistoricalAssignmentExample = {
  fieldId: string; fieldLabel: string; sectionLabel: string; mediaId: string; storageKey: string;
  sourceJobId: string; sourceSubmissionId: string; submittedAt: Date;
};
const statuses = ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] as const;
const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const labelKey = (field: Field) => JSON.stringify([normalize(field.sectionLabel), normalize(field.label)]);

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
    select: { id: true, jobId: true, submittedById: true, createdAt: true, data: true, template: { select: { schema: true } },
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
    const historical = getHistoricalSubmissionFields(submission);
    const usedFields = new Set<string>();
    for (const media of submission.media) {
      if (excluded.has(media.id) || seenKeys.has(media.s3Key)) continue;
      const source = resolveHistoricalMediaField(submission, media);
      if (!source) continue;
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
  const latest = await database.formSubmission.findFirst({ where: { job: { propertyId, status: { in: [...statuses] } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { data: true, template: { select: { schema: true } } } });
  const fields = latest ? getHistoricalSubmissionFields(latest) : [];
  const labels = fields.filter(field => fields.filter(other => other.id === field.id).length === 1).slice(0, 100);
  const result = await getHistoricalAssignmentExamples({ propertyId, currentJobId: null, fields: labels, maxImages: 200, purpose: "training" }, database);
  const revision = createHash("sha256").update(JSON.stringify({ propertyId, labels, ...result })).digest("hex");
  return { examples: result.examples, labels, revision };
}
