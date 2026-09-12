import "server-only";
import type { JobType } from "@prisma/client";
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
  options: { provisionReworkAnchor?: boolean; database?: Pick<typeof db, "formTemplate"> } = {}
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
  const template = selected
    ? { ...selected, schema: assembleJobForm(schema, jobMeta.additionals) }
    : !generatedRework && jobMeta.additionals.length > 0
      ? { id: "additionals-only", name: "Job additionals", serviceType: job.jobType,
          schema: assembleJobForm(null, jobMeta.additionals) }
      : null;
  return {
    template,
    persistedTemplateId: selected?.id ?? null,
    submittable: Boolean(selected),
    // Preserve the read API's existing normal-resolution metadata, even for rework.
    templateSource: resolution.source === "none" ? "global_latest" as const : resolution.source,
    configuredPropertyTemplateId: resolution.configuredPropertyTemplateId,
  };
}
