import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { buildDefaultQaTemplateSchema, QA_TEMPLATE_VERSION } from "@/lib/qa/templates";
import { generateQaTemplateFromChecklist } from "@/lib/qa/generate-from-checklist";

export async function resolveQaTemplate(jobId: string, persist = false) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { jobType: true, propertyId: true },
  });
  if (!job) return null;
  const propertyTemplate = await db.qaFormTemplate.findFirst({
    where: { propertyId: job.propertyId, serviceType: job.jobType, isActive: true },
    orderBy: { version: "desc" },
  });
  if (propertyTemplate) return propertyTemplate;

  // No property-specific QA form yet: derive one from the property's OWN
  // cleaner checklist if it has one. A generic four-area template cannot fail
  // the thing that actually went wrong on a property whose checklist has
  // thirteen sections. Best-effort — any problem falls through to the default.
  if (job.propertyId) {
    try {
      // A property's checklist is bound through the settings override map
      // (propertyId → jobType → templateId), NOT a column on FormTemplate —
      // there is no `FormTemplate.propertyId`.
      const settings = await getAppSettings();
      const overrideId = settings.propertyFormTemplateOverrides?.[job.propertyId]?.[job.jobType];
      const checklist = overrideId
        ? await db.formTemplate.findFirst({
            where: { id: overrideId, isActive: true },
            select: { id: true, schema: true },
          })
        : null;
      const generated = generateQaTemplateFromChecklist(checklist?.schema as any);
      if (checklist && generated) {
        if (!persist) return { id: `preview:${jobId}`, name: "QA from property checklist", schema: generated.schema, serviceType: job.jobType };
        return await db.qaFormTemplate.create({
          data: {
            name: `QA — from checklist (${String(job.jobType).replace(/_/g, " ")})`,
            serviceType: job.jobType,
            propertyId: job.propertyId,
            schema: generated.schema as any,
            sourceFormTemplateId: checklist.id,
            // Generated, but ADMIN-OWNED from here: never auto-rewritten.
            isSystemManaged: false,
          },
        });
      }
    } catch {
      /* fall through to the global default */
    }
  }

  const globalTemplate = await db.qaFormTemplate.findFirst({
    where: { propertyId: null, serviceType: job.jobType, isActive: true },
    orderBy: { version: "desc" },
  });
  if (globalTemplate) {
    // Auto-upgrade a SYSTEM-OWNED default to the latest area-based schema when
    // it's stale.
    //
    // This used to decide ownership by matching the NAME ("Default QA - …"), so
    // an admin who edited the default template in place without renaming it had
    // their work silently overwritten the next time anyone opened a job. The
    // flag is explicit and is only ever set by the system.
    const schema = globalTemplate.schema as { version?: number } | null;
    const stale =
      !schema || typeof schema !== "object" || Number(schema.version ?? 0) < QA_TEMPLATE_VERSION;
    if (persist && globalTemplate.isSystemManaged && stale) {
      return db.qaFormTemplate.update({
        where: { id: globalTemplate.id },
        data: { schema: buildDefaultQaTemplateSchema(job.jobType) as any },
      });
    }
    return globalTemplate;
  }
  if (!persist) return { id: `preview:${jobId}`, name: "Default QA", schema: buildDefaultQaTemplateSchema(job.jobType), serviceType: job.jobType };
  return db.qaFormTemplate.create({
    data: {
      name: `Default QA - ${String(job.jobType).replace(/_/g, " ")}`,
      serviceType: job.jobType,
      schema: buildDefaultQaTemplateSchema(job.jobType) as any,
      isSystemManaged: true,
    },
  });
}
