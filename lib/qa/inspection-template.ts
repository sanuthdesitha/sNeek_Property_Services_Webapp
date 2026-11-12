/**
 * QA inspections keep a copy of their template (Wave E, 2026-11).
 *
 * Every inspection (QaFormSubmission) stores the template it was filled in on:
 * the schema, its name and the template's content revision number. Reading a
 * past inspection uses that copy, so a later template edit never changes how
 * it reads or scores. Inspections saved before the copy existed were
 * backfilled from the best available revision and are marked RECONSTRUCTED:
 * the screens say so instead of claiming the copy is exact.
 */
import type { Prisma } from "@prisma/client";
import { QA_REVISION_ACTION } from "./template-admin-constants";

export type TemplateSnapshotSource = "EXACT" | "RECONSTRUCTED";

export type StoredTemplateCopy = {
  templateSnapshot: Prisma.JsonValue | null;
  templateSnapshotName: string | null;
  templateSnapshotSource: string | null;
  templateRevision: number | null;
};

type TemplateLike = { id: string; name: string; schema: Prisma.JsonValue };

/** The schema to read a past inspection with: its stored copy, else the live template (copy missing). */
export function inspectionTemplateSchema(submission: Partial<StoredTemplateCopy> & { template?: { schema: Prisma.JsonValue } | null }): Prisma.JsonValue | null {
  if (submission.templateSnapshot !== null && submission.templateSnapshot !== undefined) return submission.templateSnapshot;
  return submission.template?.schema ?? null;
}

/** Plain words for the copy's provenance, shown beside a past inspection. */
export function templateCopyLabel(submission: Partial<StoredTemplateCopy>): string {
  if (submission.templateSnapshot === null || submission.templateSnapshot === undefined) return "Template copy missing: shown with the current template";
  if (submission.templateSnapshotSource === "RECONSTRUCTED") return "Template copy reconstructed: the exact version used is not known";
  return submission.templateRevision !== null && submission.templateRevision !== undefined
    ? `Template as filled in (revision ${submission.templateRevision})`
    : "Template as filled in";
}

/** The copy to store on a new inspection: the template exactly as it is now, with its revision number. */
export async function exactTemplateCopy(tx: Pick<Prisma.TransactionClient, "auditLog">, template: TemplateLike): Promise<StoredTemplateCopy & { templateSnapshotSource: TemplateSnapshotSource }> {
  const revision = template.id.startsWith("preview:")
    ? 0
    : await tx.auditLog.count({ where: { entity: "QaFormTemplate", action: QA_REVISION_ACTION, entityId: template.id } });
  return {
    templateSnapshot: template.schema,
    templateSnapshotName: template.name,
    templateSnapshotSource: "EXACT",
    templateRevision: revision,
  };
}
