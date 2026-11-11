import "server-only";
/**
 * Duplicate a FormTemplate as a new DRAFT (isActive: false): the source's live
 * schema copied, the next version number for its kind, a de-duplicated name
 * and `parentTemplateId` pointing at the source. Shared by the duplicate route
 * and the forms library's bulk duplicate. Library organisation (group, tags)
 * is carried over so the copy appears beside its source.
 */
import { Prisma, type FormTemplate } from "@prisma/client";
import { db } from "@/lib/db";
import { duplicateTemplateName, nextTemplateVersion } from "./duplicate-template";
import { TemplateServiceError } from "./template-errors";

export async function duplicateFormTemplate(sourceId: string): Promise<FormTemplate> {
  const source = await db.formTemplate.findUnique({ where: { id: sourceId } });
  if (!source) throw new TemplateServiceError("NOT_FOUND", "Not found");

  // Versions are allocated per kind; names are de-duplicated per kind too, so
  // repeated duplicates read as "(Copy)", "(Copy 2)", … instead of a pile of
  // identically named rows the owner cannot tell apart.
  const siblings = await db.formTemplate.findMany({
    where: { kind: source.kind },
    select: { name: true, version: true },
  });

  return db.formTemplate.create({
    data: {
      name: duplicateTemplateName(source.name, siblings.map((s) => s.name)),
      kind: source.kind,
      serviceType: source.serviceType,
      version: nextTemplateVersion(siblings.map((s) => s.version)),
      schema: source.schema as Prisma.InputJsonValue,
      isActive: false,
      parentTemplateId: source.id,
      groupId: source.groupId ?? null,
      tags: source.tags ?? [],
    },
  });
}
