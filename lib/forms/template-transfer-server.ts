import "server-only";
/**
 * Database half of the library's Compare, Export and Import
 * (pure rules: template-compare.ts, template-transfer.ts).
 *
 *  - Compare and Export read each form's current content: its draft when it
 *    has one (what the builder shows), else the live schema; the file and the
 *    comparison say which.
 *  - Import only ever CREATES new rows: kind CUSTOM, the next version for that
 *    kind, `isActive: false` (a draft, not live, never published here), no
 *    group, a de-duplicated name. An existing form is never changed.
 */
import { FormKind, JobType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { nextTemplateVersion } from "./duplicate-template";
import { readTemplateDraft } from "./template-drafts";
import { TemplateServiceError } from "./template-errors";
import { compareTemplates, COMPARE_MAX_FORMS, COMPARE_MIN_FORMS, type CompareFormInput, type TemplateComparison } from "./template-compare";
import { buildExportFile, EXPORT_MAX_FORMS, importedName, parseImportFile, type FormExportFile, type ImportOutcome } from "./template-transfer";

type CurrentContent = CompareFormInput & { serviceType: string; tags: string[] };

async function readCurrent(ids: string[]): Promise<CurrentContent[]> {
  const unique = Array.from(new Set(ids));
  const templates = await db.formTemplate.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, version: true, schema: true, serviceType: true, tags: true },
  });
  if (templates.length !== unique.length) throw new TemplateServiceError("NOT_FOUND", "One or more of the chosen forms no longer exist.");
  const byId = new Map(templates.map((template) => [template.id, template]));
  const out: CurrentContent[] = [];
  for (const id of unique) {
    const template = byId.get(id)!;
    const draft = await readTemplateDraft(id);
    out.push({
      id,
      name: draft?.name ?? template.name,
      version: template.version,
      source: draft ? "draft" : "live",
      schema: draft ? draft.schema : template.schema,
      serviceType: String(draft?.serviceType ?? template.serviceType),
      tags: template.tags ?? [],
    });
  }
  return out;
}

export async function compareFormTemplates(ids: string[]): Promise<TemplateComparison> {
  const unique = Array.from(new Set(ids));
  if (unique.length < COMPARE_MIN_FORMS || unique.length > COMPARE_MAX_FORMS) {
    throw new TemplateServiceError("INVALID_SCHEMA", `Choose ${COMPARE_MIN_FORMS} to ${COMPARE_MAX_FORMS} forms to compare.`);
  }
  return compareTemplates(await readCurrent(unique));
}

export async function exportFormTemplates(ids: string[], now = new Date()): Promise<FormExportFile> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0 || unique.length > EXPORT_MAX_FORMS) {
    throw new TemplateServiceError("INVALID_SCHEMA", `Choose 1 to ${EXPORT_MAX_FORMS} forms to export.`);
  }
  const current = await readCurrent(unique);
  return buildExportFile(
    current.map((form) => ({ name: form.name, serviceType: form.serviceType, tags: form.tags, source: form.source, sourceVersion: form.version, schema: form.schema })),
    now,
  );
}

export type { ImportOutcome };

/** Validate (dry run) or create the forms of an uploaded file as drafts. */
export async function importFormTemplates(input: { text: string; dryRun: boolean; actorId: string }): Promise<ImportOutcome> {
  const parsed = parseImportFile(input.text, Object.values(JobType));
  if (!parsed.ok) throw new TemplateServiceError("INVALID_SCHEMA", parsed.error);
  const refused = parsed.forms.filter((form) => form.refused).length;
  if (input.dryRun) return { dryRun: true, forms: parsed.forms, created: 0, refused };

  const results = await db.$transaction(async (tx) => {
    const siblings = await tx.formTemplate.findMany({ where: { kind: FormKind.CUSTOM }, select: { name: true, version: true } });
    const names = siblings.map((row) => row.name);
    const versions = siblings.map((row) => row.version);
    const out: ImportOutcome["forms"] = [];
    for (const form of parsed.forms) {
      if (form.refused) {
        out.push(form);
        continue;
      }
      const name = importedName(form.name, names);
      const version = nextTemplateVersion(versions);
      const created = await tx.formTemplate.create({
        data: {
          name,
          kind: FormKind.CUSTOM,
          serviceType: form.serviceType as JobType,
          version,
          schema: form.schema as Prisma.InputJsonValue,
          isActive: false,
          tags: form.tags,
        },
        select: { id: true, name: true },
      });
      await tx.auditLog.create({
        data: { userId: input.actorId, action: "FORM_TEMPLATE_IMPORTED", entity: "FormTemplate", entityId: created.id, after: { name, serviceType: form.serviceType, questions: form.questions } },
      });
      names.push(name);
      versions.push(version);
      out.push({ ...form, createdId: created.id, createdName: created.name });
    }
    return out;
  });
  return { dryRun: false, forms: results, created: results.filter((form) => form.createdId).length, refused };
}
