import { withDeviceChargingEvidence } from "./device-charging";
import { withDeviceApplicability } from "./device-status";
import "server-only";
import { withLaundryAreaEvidence } from "./laundry-area";
import type { JobType } from "@prisma/client";
import { collectMonthlyItems, collectRotationalItems, filterRotationalSchema } from "@/lib/accountability/rotation-schema";
import { db } from "@/lib/db";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { assembleJobForm } from "./assemble-job-form";
import { expandRepeatedSections, schemaHasRepeatedSections, type RoomCounts } from "./repeat-sections";
import { resolveJobFormTemplate, type TemplateOverridesMap } from "./resolve-job-template";
import { buildReworkFormSchema, ensureReworkFormTemplate, findReworkFormTemplate, normalizeReworkAreas } from "@/lib/qa/rework-jobs";

/** Server selection and assembly only. Reference signing belongs to the read route. */
export async function resolveEffectiveJobForm(
  job: { jobType: JobType; propertyId: string; formTemplateId?: string | null;
    isRework: boolean; reworkAreas?: unknown; internalNotes?: string | null; property?: { name?: unknown; bedrooms?: unknown; bathrooms?: unknown } },
  settings: { propertyFormTemplateOverrides?: TemplateOverridesMap | null; timezone?: string | null },
  options: {
    provisionReworkAnchor?: boolean;
    database?: Pick<typeof db, "formTemplate"> & Partial<Pick<typeof db, "propertyRotationState" | "property">>;
    /** Clock for "Monthly" questions (tests); defaults to now. */
    now?: Date;
  } = {}
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
  // Per-room repeat (section.repeatBy): only forms that use it read the room
  // counts; every other form is untouched. Fails closed — a repeated section
  // is never silently shown once because the counts could not be read.
  if (template && schemaHasRepeatedSections(template.schema)) {
    template = { ...template, schema: expandRepeatedSections(template.schema, await roomCountsFor(job, database)) };
  }
  if (template && selected) template = { ...template, schema: withLaundryAreaEvidence(template.schema, job) };
  if (template) template = { ...template, schema: withDeviceApplicability(template.schema, job.property) };
  const fullRotationSections = (template?.schema as any)?.sections ?? [];
  const rotationalItems = collectRotationalItems(template?.schema);
  const monthlyItems = collectMonthlyItems(template?.schema);
  if (template && (rotationalItems.length > 0 || monthlyItems.length > 0) && !job.isRework) {
    if (!database.propertyRotationState) throw new Error("Rotation state reader is unavailable");
    const keys = Array.from(new Set([...rotationalItems.map(item => item.key), ...monthlyItems]));
    // Monthly questions also read the last-shown date; forms without one keep
    // the exact read they always made.
    const states = await database.propertyRotationState.findMany({
      where: { propertyId: job.propertyId, itemKey: { in: keys } },
      select: monthlyItems.length > 0 ? { itemKey: true, cleansSinceDone: true, lastCompletedAt: true } : { itemKey: true, cleansSinceDone: true },
    });
    const monthly = monthlyItems.length > 0
      ? { now: options.now ?? new Date(), timeZone: settings.timezone || "Australia/Sydney" }
      : undefined;
    template = { ...template, schema: filterRotationalSchema(template.schema, states, monthly) };
  }
  if (template) template = { ...template, schema: withDeviceChargingEvidence(template.schema, job) };
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

async function roomCountsFor(
  job: { propertyId: string; property?: { bedrooms?: unknown; bathrooms?: unknown } },
  database: Partial<Pick<typeof db, "property">>,
): Promise<RoomCounts> {
  if (job.property && "bedrooms" in job.property && "bathrooms" in job.property) {
    return { bedrooms: job.property.bedrooms, bathrooms: job.property.bathrooms };
  }
  if (!database.property) throw new Error("Property room counts are unavailable");
  const property = await database.property.findUnique({
    where: { id: job.propertyId },
    select: { bedrooms: true, bathrooms: true },
  });
  if (!property) throw new Error("Property room counts are unavailable");
  return { bedrooms: property.bedrooms, bathrooms: property.bathrooms };
}
