import "server-only";
/**
 * Duplicate a FormTemplate as a new DRAFT (isActive: false): the source's live
 * schema copied, the next version number for its kind, a de-duplicated name
 * and `parentTemplateId` pointing at the source. Shared by the duplicate route
 * and the forms library's bulk duplicate. Library organisation (group, tags)
 * is carried over so the copy appears beside its source.
 *
 * `fromDraft` (the builder's Duplicate): when the source has a DRAFT version,
 * the copy is made from the draft — what the admin sees in the builder — not
 * the live schema. Without a draft, or from the library, the live schema is
 * copied as before.
 */
import { Prisma, type FormTemplate } from "@prisma/client";
import { db } from "@/lib/db";
import { duplicateTemplateName, nextTemplateVersion } from "./duplicate-template";
import { TemplateServiceError } from "./template-errors";
import { readTemplateDraft } from "./template-drafts";

export async function duplicateFormTemplate(sourceId: string, options: { fromDraft?: boolean } = {}): Promise<FormTemplate> {
  const source = await db.formTemplate.findUnique({ where: { id: sourceId } });
  if (!source) throw new TemplateServiceError("NOT_FOUND", "Not found");
  const draft = options.fromDraft ? await readTemplateDraft(source.id) : null;

  // Versions are allocated per kind; names are de-duplicated per kind too, so
  // repeated duplicates read as "(Copy)", "(Copy 2)", … instead of a pile of
  // identically named rows the owner cannot tell apart.
  const siblings = await db.formTemplate.findMany({
    where: { kind: source.kind },
    select: { name: true, version: true },
  });

  return db.formTemplate.create({
    data: {
      name: duplicateTemplateName(draft?.name ?? source.name, siblings.map((s) => s.name)),
      kind: source.kind,
      serviceType: draft?.serviceType ?? source.serviceType,
      version: nextTemplateVersion(siblings.map((s) => s.version)),
      schema: (draft ? draft.schema : source.schema) as Prisma.InputJsonValue,
      isActive: false,
      parentTemplateId: source.id,
      groupId: source.groupId ?? null,
      tags: source.tags ?? [],
    },
  });
}
