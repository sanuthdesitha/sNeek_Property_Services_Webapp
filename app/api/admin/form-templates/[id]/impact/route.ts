import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { JobStatus, Role } from "@prisma/client";
import {
  propertiesOverridingServiceType,
  propertiesUsingTemplate,
  resolveJobFormTemplate,
} from "@/lib/forms/resolve-job-template";

export const dynamic = "force-dynamic";

/** Jobs that have not yet been submitted still pick up template edits. */
const OPEN_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
];

/**
 * "Where does this template actually apply?" — the answer the form builder has
 * never been able to give, which is why editing a template and seeing nothing
 * change on the cleaner app has read as a bug.
 *
 * Returns, resolved with the SAME rule the runtime uses
 * (lib/forms/resolve-job-template.ts):
 *  - publish state (a draft is edited-but-never-live)
 *  - whether this row is the global default for its service type, and which row
 *    is if it is not
 *  - whether this row is a PROPERTY-SCOPED template (generated from a checklist
 *    profile or minted by a quote conversion) — global edits never reach the
 *    properties that own one, and re-approving the checklist profile REPLACES
 *    this row, discarding manual builder edits
 *  - how many properties override this service type (edits here skip them)
 *  - how many open jobs will actually render this template
 *  - how many submissions already snapshotted it (those never change, by design)
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const template = await db.formTemplate.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        serviceType: true,
        kind: true,
        version: true,
        isActive: true,
        publishedAt: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        isJobScoped: true,
      },
    });
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const settings = await getAppSettings();
    const overrides = settings.propertyFormTemplateOverrides;

    const activeSiblings = await db.formTemplate.findMany({
      where: { serviceType: template.serviceType, isActive: true },
      select: {
        id: true,
        name: true,
        serviceType: true,
        isActive: true,
        version: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        isJobScoped: true,
      },
    });

    // Properties whose override points at THIS row.
    const ownedPropertyIds = propertiesUsingTemplate(overrides, template.id);
    // Properties overriding this SERVICE TYPE at all (whatever row they point at).
    const overridingThisService = propertiesOverridingServiceType(overrides, template.serviceType);
    const divergentPropertyIds = overridingThisService
      .filter((row) => row.templateId !== template.id)
      .map((row) => row.propertyId);

    const propertyIds = Array.from(new Set([...ownedPropertyIds, ...divergentPropertyIds]));
    const properties = propertyIds.length
      ? await db.property.findMany({
          where: { id: { in: propertyIds } },
          select: { id: true, name: true, checklistProfile: { select: { generatedTemplateIds: true } } },
        })
      : [];
    const nameById = new Map(properties.map((p) => [p.id, p.name]));

    // Is this row a GENERATED per-property checklist template? If so, editing it
    // here is legitimate but fragile: re-approving the property's checklist
    // profile mints a brand-new row and archives this one (compose.ts
    // generatePropertyTemplates), discarding these edits.
    const generatedForPropertyId =
      properties.find((p) => {
        const ids = p.checklistProfile?.generatedTemplateIds;
        if (!ids || typeof ids !== "object") return false;
        return Object.values(ids as Record<string, unknown>).includes(template.id);
      })?.id ?? null;

    // Which row a property with NO override would get for this service type.
    const globalDefault = resolveJobFormTemplate({
      jobType: template.serviceType,
      propertyId: "__no_such_property__",
      overrides,
      templates: activeSiblings,
    }).template;

    // Open jobs of this service type, resolved one by one.
    const openJobs = await db.job.findMany({
      where: { jobType: template.serviceType, status: { in: OPEN_JOB_STATUSES } },
      select: { id: true, propertyId: true, jobType: true, formTemplateId: true },
      take: 500,
    });
    // Resolve per property (not per job) so the sort runs once per distinct
    // property rather than once per job. A PINNED job is resolved on its own —
    // its answer is job-specific by definition, so it cannot use the cache.
    const resolvedByProperty = new Map<string, string | null>();
    let openJobsUsingThis = 0;
    for (const job of openJobs) {
      let resolvedId: string | null | undefined;
      if (job.formTemplateId) {
        resolvedId =
          resolveJobFormTemplate({
            jobType: job.jobType,
            propertyId: job.propertyId,
            overrides,
            templates: activeSiblings,
            jobTemplateId: job.formTemplateId,
          }).template?.id ?? null;
      } else {
        resolvedId = resolvedByProperty.get(job.propertyId);
        if (resolvedId === undefined) {
          resolvedId =
            resolveJobFormTemplate({
              jobType: job.jobType,
              propertyId: job.propertyId,
              overrides,
              templates: activeSiblings,
            }).template?.id ?? null;
          resolvedByProperty.set(job.propertyId, resolvedId);
        }
      }
      if (resolvedId === template.id) openJobsUsingThis += 1;
    }

    const submissionCount = await db.formSubmission.count({ where: { templateId: template.id } });

    const status = template.archivedAt
      ? ("archived" as const)
      : template.isActive
        ? ("published" as const)
        : ("draft" as const);

    return NextResponse.json({
      template: {
        id: template.id,
        name: template.name,
        serviceType: template.serviceType,
        kind: template.kind,
        version: template.version,
      },
      status,
      /** True when a job with no property override renders THIS row. */
      isGlobalDefault: globalDefault?.id === template.id,
      globalDefault: globalDefault
        ? { id: globalDefault.id, name: globalDefault.name, version: globalDefault.version }
        : null,
      /** Registered as some property's override → never the global default. */
      propertyScoped: ownedPropertyIds.length > 0,
      /**
       * Minted for ONE job (quote → job conversion) and pinned to it. Editing
       * this row only affects that job; it is never a global default.
       */
      jobScoped: template.isJobScoped === true,
      /** Generated from a checklist profile → re-approval replaces this row. */
      generatedForProperty: generatedForPropertyId
        ? { id: generatedForPropertyId, name: nameById.get(generatedForPropertyId) ?? generatedForPropertyId }
        : null,
      usedByProperties: ownedPropertyIds.map((id) => ({ id, name: nameById.get(id) ?? id })),
      /** Properties that override this service type with a DIFFERENT template. */
      divergentProperties: divergentPropertyIds.map((id) => ({ id, name: nameById.get(id) ?? id })),
      openJobsUsingThis,
      openJobsOfServiceType: openJobs.length,
      submissionCount,
      activeSiblingCount: activeSiblings.length,
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
