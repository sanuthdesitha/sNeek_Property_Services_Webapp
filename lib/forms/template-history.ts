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
  const summaries = rows.map<TemplateVersionSummary>((row) => ({
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
  }));
  return {
    templateId,
    liveVersion: template.version,
    draft: summaries.find((row) => row.kind === FormTemplateVersionKind.DRAFT) ?? null,
    versions: summaries.filter((row) => row.kind === FormTemplateVersionKind.PUBLISHED),
  };
}
