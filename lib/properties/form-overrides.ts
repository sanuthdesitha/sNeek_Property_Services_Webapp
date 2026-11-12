import "server-only";
/**
 * Per-property form (checklist) template overrides, stored in
 * `settings.propertyFormTemplateOverrides[propertyId][jobType]`. Shared by the
 * single-property route (PATCH /api/admin/properties/:id/form-overrides) and
 * the Properties bulk "Assign checklist", so both validate and audit alike.
 */
import { JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings, saveAppSettings } from "@/lib/settings";

export type PropertyFormOverrides = Partial<Record<JobType, string>>;

export class FormOverrideError extends Error {
  readonly status = 400;
}

/** Every requested template must be active and of the job type it is set for. */
export async function validateOverrideTemplates(requested: PropertyFormOverrides): Promise<void> {
  const templateIds = Array.from(new Set(Object.values(requested).filter((id): id is string => Boolean(id))));
  if (templateIds.length === 0) return;
  const templates = await db.formTemplate.findMany({
    where: { id: { in: templateIds }, isActive: true },
    select: { id: true, serviceType: true },
  });
  const templateById = new Map(templates.map((template) => [template.id, template]));
  for (const jobType of Object.values(JobType)) {
    const templateId = requested[jobType];
    if (!templateId) continue;
    const template = templateById.get(templateId);
    if (!template) throw new FormOverrideError(`Template ${templateId} is not active or does not exist.`);
    if (template.serviceType !== jobType) {
      throw new FormOverrideError(`Template ${templateId} does not match ${jobType.replace(/_/g, " ")}.`);
    }
  }
}

export async function readPropertyFormOverrides(propertyId: string): Promise<PropertyFormOverrides> {
  const settings = await getAppSettings();
  return { ...(settings.propertyFormTemplateOverrides?.[propertyId] ?? {}) } as PropertyFormOverrides;
}

export type OverrideChange = { propertyId: string; next: PropertyFormOverrides };

/**
 * Writes the complete override map for each property in one settings save and
 * an audit row per property (before / after). An empty map removes the entry.
 */
export async function writePropertyFormOverrides(
  changes: OverrideChange[],
  actorId: string,
  ipAddress: string | null,
): Promise<Map<string, PropertyFormOverrides>> {
  const settings = await getAppSettings();
  const current = { ...(settings.propertyFormTemplateOverrides ?? {}) } as Record<string, PropertyFormOverrides>;
  const before = new Map(changes.map((change) => [change.propertyId, current[change.propertyId] ?? {}]));
  for (const change of changes) {
    if (Object.keys(change.next).length > 0) current[change.propertyId] = change.next;
    else delete current[change.propertyId];
  }
  const updated = await saveAppSettings({ propertyFormTemplateOverrides: current });
  const after = new Map<string, PropertyFormOverrides>();
  for (const change of changes) {
    const saved = (updated.propertyFormTemplateOverrides?.[change.propertyId] ?? {}) as PropertyFormOverrides;
    after.set(change.propertyId, saved);
    await db.auditLog.create({
      data: {
        userId: actorId,
        action: "PROPERTY_FORM_OVERRIDES_UPDATE",
        entity: "Property",
        entityId: change.propertyId,
        before: before.get(change.propertyId) as object,
        after: saved as object,
        ipAddress,
      },
    });
  }
  return after;
}
