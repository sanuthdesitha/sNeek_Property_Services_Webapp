import "server-only";
/** Read side of form-template version history (FormTemplateVersion rows). */
import { FormTemplateVersionKind } from "@prisma/client";
import { db } from "@/lib/db";
import { countQuestions } from "./template-questions";
import { TemplateServiceError } from "./template-errors";

export type TemplateVersionSummary = {
  id: string;
  kind: FormTemplateVersionKind;
  /** Published: the version number. Draft: the live version it is based on. */
  version: number;
  name: string | null;
  note: string | null;
  questionCount: number;
  restoredFromVersionId: string | null;
  createdById: string | null;
  /** Name (or email) of the author; null when unknown or removed. */
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TemplateVersionHistory = {
  templateId: string;
  liveVersion: number;
  draft: TemplateVersionSummary | null;
  versions: TemplateVersionSummary[];
};

export async function listTemplateVersionHistory(templateId: string): Promise<TemplateVersionHistory> {
  const template = await db.formTemplate.findUnique({ where: { id: templateId }, select: { id: true, version: true } });
  if (!template) throw new TemplateServiceError("NOT_FOUND", "Not found");
  const rows = await db.formTemplateVersion.findMany({
    where: { templateId },
    orderBy: [{ kind: "asc" }, { version: "desc" }, { createdAt: "desc" }],
  });
  const authorIds = Array.from(new Set(rows.map((row) => row.createdById).filter((id): id is string => Boolean(id))));
  const authors = authorIds.length
    ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const authorName = new Map(authors.map((user) => [user.id, user.name ?? user.email ?? null]));
  const summaries = rows.map<TemplateVersionSummary>((row) => ({
    id: row.id,
    kind: row.kind,
    version: row.version,
    name: row.name,
    note: row.note,
    questionCount: countQuestions(row.schema),
    restoredFromVersionId: row.restoredFromVersionId,
    createdById: row.createdById,
    createdByName: row.createdById ? authorName.get(row.createdById) ?? null : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
  return {
    templateId,
    liveVersion: template.version,
    draft: summaries.find((row) => row.kind === FormTemplateVersionKind.DRAFT) ?? null,
    versions: summaries.filter((row) => row.kind === FormTemplateVersionKind.PUBLISHED),
  };
}

export type TemplateVersionDetail = TemplateVersionSummary & {
  schema: unknown;
  /** The live schema now, for "changes against live". */
  liveSchema: unknown;
  createdByName: string | null;
};

/** One version row with its schema. A version of another form is not found. */
export async function readTemplateVersion(templateId: string, versionId: string): Promise<TemplateVersionDetail> {
  const [template, row] = await Promise.all([
    db.formTemplate.findUnique({ where: { id: templateId }, select: { id: true, schema: true } }),
    db.formTemplateVersion.findFirst({ where: { id: versionId, templateId } }),
  ]);
  if (!template || !row) throw new TemplateServiceError("NOT_FOUND", "That version does not belong to this form.");
  const author = row.createdById
    ? await db.user.findUnique({ where: { id: row.createdById }, select: { name: true, email: true } })
    : null;
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    name: row.name,
    note: row.note,
    questionCount: countQuestions(row.schema),
    restoredFromVersionId: row.restoredFromVersionId,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    schema: row.schema,
    liveSchema: template.schema,
    createdByName: author?.name ?? author?.email ?? null,
  };
}
