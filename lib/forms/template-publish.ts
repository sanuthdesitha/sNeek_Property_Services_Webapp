import "server-only";
/**
 * Publish, archive and unarchive a FormTemplate — the rules the publish route
 * always had, moved here so the forms library's bulk publish uses the same
 * code, plus draft versions:
 *
 *  - publish:   when the template has a DRAFT version, the draft's schema (and
 *               name / service type) is copied to the live row, the live
 *               version number goes up by one and a PUBLISHED version row
 *               records it; the draft is then removed. Without a draft the
 *               live row is published as it is (the historical behaviour) and
 *               a baseline version row is recorded if none exists yet.
 *               Either way: isActive=true, publishedAt=now, archivedAt=null,
 *               and the PRIOR active GLOBAL template of the same service type
 *               is archived (property-scoped and job-scoped rows are skipped
 *               on both sides — see resolve-job-template.ts).
 *  - archive:   isActive=false, archivedAt=now
 *  - unarchive: archivedAt=null (does NOT republish — left as draft)
 */
import { FormTemplateVersionKind, Prisma, type FormTemplate } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { collectPropertyScopedTemplateIds } from "./resolve-job-template";
import { formTemplateSchemaZ } from "./template-schema";
import { isStaleTemplateWrite } from "./template-concurrency";
import { readTemplateDraft, templateEditToken } from "./template-drafts";
import { staleTemplateError, TemplateServiceError } from "./template-errors";

type Tx = Prisma.TransactionClient;

export type PublishResult = {
  template: FormTemplate;
  archivedPrevious: number;
  /** The new live version when a draft was published; null otherwise. */
  publishedVersion: number | null;
  /** Token the builder sends on its next save. */
  editToken: string;
};

/** Every template registered as some property's per-job-type override. */
export async function propertyScopedTemplateIds(): Promise<Set<string>> {
  const settings = await getAppSettings();
  return collectPropertyScopedTemplateIds(settings.propertyFormTemplateOverrides);
}

async function nextLiveVersion(tx: Tx, templateId: string, currentVersion: number): Promise<number> {
  const latest = await tx.formTemplateVersion.aggregate({
    where: { templateId, kind: FormTemplateVersionKind.PUBLISHED },
    _max: { version: true },
  });
  return Math.max(currentVersion, latest._max.version ?? 0) + 1;
}

async function publishDraft(tx: Tx, template: FormTemplate, actorId: string | null): Promise<{ template: FormTemplate; version: number | null }> {
  const draft = await readTemplateDraft(template.id, tx);
  const now = new Date();
  if (!draft) {
    await tx.formTemplateVersion.createMany({
      data: [{
        templateId: template.id,
        kind: FormTemplateVersionKind.PUBLISHED,
        version: template.version,
        schema: template.schema as Prisma.InputJsonValue,
        name: template.name,
        serviceType: template.serviceType,
        note: "Published as it was",
        createdById: actorId,
      }],
      skipDuplicates: true,
    });
    const updated = await tx.formTemplate.update({
      where: { id: template.id },
      data: { isActive: true, publishedAt: now, archivedAt: null },
    });
    return { template: updated, version: null };
  }
  const parsed = formTemplateSchemaZ.safeParse(draft.schema);
  if (!parsed.success) {
    throw new TemplateServiceError("INVALID_SCHEMA", `The draft cannot be published: ${parsed.error.issues[0]?.message ?? "invalid structure"}.`);
  }
  const version = await nextLiveVersion(tx, template.id, template.version);
  const name = draft.name ?? template.name;
  const serviceType = draft.serviceType ?? template.serviceType;
  await tx.formTemplateVersion.create({
    data: {
      templateId: template.id,
      kind: FormTemplateVersionKind.PUBLISHED,
      version,
      schema: parsed.data as Prisma.InputJsonValue,
      name,
      serviceType,
      note: draft.note,
      restoredFromVersionId: draft.restoredFromVersionId,
      createdById: actorId,
    },
  });
  // Conditional on the row read in this transaction: a concurrent write wins
  // the race and this publish is refused rather than overwriting it.
  const result = await tx.formTemplate.updateMany({
    where: { id: template.id, updatedAt: template.updatedAt },
    data: {
      schema: parsed.data as Prisma.InputJsonValue,
      name,
      serviceType,
      version,
      isActive: true,
      publishedAt: now,
      archivedAt: null,
    },
  });
  if (result.count !== 1) throw staleTemplateError(new Date().toISOString());
  await tx.formTemplateVersion.deleteMany({ where: { templateId: template.id, kind: FormTemplateVersionKind.DRAFT } });
  return { template: await tx.formTemplate.findUniqueOrThrow({ where: { id: template.id } }), version };
}

async function retirePreviousGlobal(tx: Tx, template: FormTemplate, scoped: Set<string>): Promise<number> {
  // Only a GLOBAL publish retires the previous global default.
  if (scoped.has(template.id)) return 0;
  const result = await tx.formTemplate.updateMany({
    where: {
      serviceType: template.serviceType,
      isActive: true,
      id: { notIn: [template.id, ...Array.from(scoped)] },
      // One-off forms minted for a single job are not competing defaults.
      isJobScoped: false,
    },
    data: { isActive: false, archivedAt: new Date() },
  });
  return result.count;
}

export async function publishFormTemplate(input: {
  templateId: string;
  actorId: string | null;
  /** Optional edit token from an open editor; a stale one is refused. */
  expectedToken?: string;
}): Promise<PublishResult> {
  const scoped = await propertyScopedTemplateIds();
  return db.$transaction(async (tx) => {
    const template = await tx.formTemplate.findUnique({ where: { id: input.templateId } });
    if (!template) throw new TemplateServiceError("NOT_FOUND", "Form template not found.");
    if (input.expectedToken) {
      const token = templateEditToken(template.updatedAt, await readTemplateDraft(template.id, tx));
      if (isStaleTemplateWrite(new Date(token), input.expectedToken)) throw staleTemplateError(token);
    }
    const published = await publishDraft(tx, template, input.actorId);
    const archivedPrevious = await retirePreviousGlobal(tx, published.template, scoped);
    return {
      template: published.template,
      archivedPrevious,
      publishedVersion: published.version,
      editToken: templateEditToken(published.template.updatedAt, null),
    };
  });
}

async function setRetirement(templateId: string, data: Prisma.FormTemplateUpdateInput): Promise<{ template: FormTemplate; editToken: string }> {
  const existing = await db.formTemplate.findUnique({ where: { id: templateId }, select: { id: true } });
  if (!existing) throw new TemplateServiceError("NOT_FOUND", "Form template not found.");
  const template = await db.formTemplate.update({ where: { id: templateId }, data });
  return { template, editToken: templateEditToken(template.updatedAt, await readTemplateDraft(templateId)) };
}

export function archiveFormTemplate(templateId: string) {
  return setRetirement(templateId, { isActive: false, archivedAt: new Date() });
}

export function unarchiveFormTemplate(templateId: string) {
  return setRetirement(templateId, { archivedAt: null });
}
