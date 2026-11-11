import "server-only";
/**
 * QA template administration beyond create/edit: revision history, duplicate
 * and delete. No schema change:
 *
 *  - Revision history: every content save (name or schema) writes an audit row
 *    `QA_TEMPLATE_REVISION` holding the revision number and the schema BEFORE
 *    the save. The `version` column is NOT bumped on save, because it decides
 *    which active template of a scope inspections resolve to
 *    (template-resolution.ts); bumping it would silently change that.
 *  - Duplicate: a copy in the same scope, inactive, so it never takes over
 *    resolution until an admin switches it on.
 *  - Delete: a template that any inspection used is deactivated, never removed,
 *    so historical inspections keep their template; an unused one is deleted.
 */
import { Prisma, type QaFormTemplate } from "@prisma/client";
import { db } from "@/lib/db";

export const QA_REVISION_ACTION = "QA_TEMPLATE_REVISION";

export class QaTemplateNotFoundError extends Error {
  constructor() {
    super("QA template not found.");
  }
}

type Tx = Prisma.TransactionClient;

/** How many content revisions each template has had (from the audit log). */
export async function qaRevisionCounts(templateIds: string[]): Promise<Map<string, number>> {
  if (templateIds.length === 0) return new Map();
  const rows = await db.auditLog.groupBy({
    by: ["entityId"],
    where: { entity: "QaFormTemplate", action: QA_REVISION_ACTION, entityId: { in: templateIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [String(row.entityId), row._count._all]));
}

/** Record one content revision inside the save's transaction; returns its number. */
export async function recordQaRevision(
  tx: Tx,
  input: { template: QaFormTemplate; actorId: string; nextName: string | undefined; nextSchema: unknown },
): Promise<number> {
  const previous = await tx.auditLog.count({
    where: { entity: "QaFormTemplate", action: QA_REVISION_ACTION, entityId: input.template.id },
  });
  const revision = previous + 1;
  await tx.auditLog.create({
    data: {
      userId: input.actorId,
      action: QA_REVISION_ACTION,
      entity: "QaFormTemplate",
      entityId: input.template.id,
      before: { name: input.template.name, schema: input.template.schema as Prisma.InputJsonValue },
      after: {
        revision,
        name: input.nextName ?? input.template.name,
        schemaChanged: input.nextSchema !== undefined,
      },
    },
  });
  return revision;
}

export async function duplicateQaTemplate(id: string, actorId: string): Promise<QaFormTemplate> {
  return db.$transaction(async (tx) => {
    const source = await tx.qaFormTemplate.findUnique({ where: { id } });
    if (!source) throw new QaTemplateNotFoundError();
    const latest = await tx.qaFormTemplate.findFirst({
      where: { serviceType: source.serviceType, propertyId: source.propertyId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const copy = await tx.qaFormTemplate.create({
      data: {
        name: `${source.name} (copy)`.slice(0, 160),
        serviceType: source.serviceType,
        propertyId: source.propertyId,
        version: (latest?.version ?? source.version) + 1,
        isActive: false,
        isSystemManaged: false,
        sourceFormTemplateId: source.sourceFormTemplateId,
        schema: source.schema as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "QA_TEMPLATE_DUPLICATE", entity: "QaFormTemplate", entityId: copy.id, after: { sourceId: source.id } },
    });
    return copy;
  });
}

export type QaDeleteOutcome = { outcome: "deleted" } | { outcome: "deactivated"; inspections: number };

export async function deleteQaTemplate(id: string, actorId: string): Promise<QaDeleteOutcome> {
  return db.$transaction(async (tx) => {
    const template = await tx.qaFormTemplate.findUnique({ where: { id } });
    if (!template) throw new QaTemplateNotFoundError();
    const inspections = await tx.qaFormSubmission.count({ where: { templateId: id } });
    if (inspections > 0) {
      await tx.qaFormTemplate.update({ where: { id }, data: { isActive: false } });
      await tx.auditLog.create({
        data: { userId: actorId, action: "QA_TEMPLATE_DEACTIVATE", entity: "QaFormTemplate", entityId: id, after: { reason: "delete requested; used by inspections", inspections } },
      });
      return { outcome: "deactivated", inspections };
    }
    await tx.qaFormTemplate.delete({ where: { id } });
    await tx.auditLog.create({
      data: { userId: actorId, action: "QA_TEMPLATE_DELETE", entity: "QaFormTemplate", entityId: id, before: { name: template.name, serviceType: template.serviceType, propertyId: template.propertyId, version: template.version } },
    });
    return { outcome: "deleted" };
  });
}
