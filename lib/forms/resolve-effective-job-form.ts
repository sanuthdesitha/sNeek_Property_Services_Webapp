import "server-only";
import type { JobType } from "@prisma/client";
import { collectRotationalItems, filterRotationalSchema } from "@/lib/accountability/rotation-schema";
import { db } from "@/lib/db";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { assembleJobForm } from "./assemble-job-form";
import { resolveJobFormTemplate, type TemplateOverridesMap } from "./resolve-job-template";
import { buildReworkFormSchema, ensureReworkFormTemplate, findReworkFormTemplate, normalizeReworkAreas } from "@/lib/qa/rework-jobs";

/** Server selection and assembly only. Reference signing belongs to the read route. */
export async function resolveEffectiveJobForm(
  job: { jobType: JobType; propertyId: string; formTemplateId?: string | null;
    isRework: boolean; reworkAreas?: unknown; internalNotes?: string | null },
  settings: { propertyFormTemplateOverrides?: TemplateOverridesMap | null },
  options: { provisionReworkAnchor?: boolean; database?: Pick<typeof db, "formTemplate"> & Partial<Pick<typeof db, "propertyRotationState">> } = {}
) {
  const database = options.database ?? db;
  const templates = await database.formTemplate.findMany({
    where: { serviceType: job.jobType, isActive: true },
  });
  const resolution = resolveJobFormTemplate({ jobType: job.jobType, propertyId: job.propertyId,
    jobTemplateId: job.formTemplateId, overrides: settings.propertyFormTemplateOverrides, templates });
  const jobMeta = parseJobInternalNotes(job.internalNotes);
  const areas = job.isRework ? normalizeReworkAreas(job.reworkAreas) : [];
  const generatedRework = job.isRework && areas.length > 0;
  const selected = generatedRework
    ? await (options.provisionReworkAnchor ? ensureReworkFormTemplate(job.jobType) : findReworkFormTemplate(job.jobType, database))
    : resolution.template;
  const schema = generatedRework
    ? buildReworkFormSchema(areas, { categorized: jobMeta.reworkCategorized })
    : selected?.schema;
  let template = selected
    ? { ...selected, schema: assembleJobForm(schema, jobMeta.additionals) }
    : !generatedRework && jobMeta.additionals.length > 0
      ? { id: "additionals-only", name: "Job additionals", serviceType: job.jobType,
          schema: assembleJobForm(null, jobMeta.additionals) }
      : null;
  const fullRotationSections = (template?.schema as any)?.sections ?? [];
  const rotationalItems = collectRotationalItems(template?.schema);
  if (template && rotationalItems.length > 0 && !job.isRework) {
    if (!database.propertyRotationState) throw new Error("Rotation state reader is unavailable");
    const states = await database.propertyRotationState.findMany({
      where: { propertyId: job.propertyId, itemKey: { in: rotationalItems.map(item => item.key) } },
      select: { itemKey: true, cleansSinceDone: true },
    });
    template = { ...template, schema: filterRotationalSchema(template.schema, states) };
  }
  return {
    fullRotationSections,
    template,
    persistedTemplateId: selected?.id ?? null,
    submittable: Boolean(selected),
    // Preserve the read API's existing normal-resolution metadata, even for rework.
    templateSource: resolution.source === "none" ? "global_latest" as const : resolution.source,
    configuredPropertyTemplateId: resolution.configuredPropertyTemplateId,
  };
}
