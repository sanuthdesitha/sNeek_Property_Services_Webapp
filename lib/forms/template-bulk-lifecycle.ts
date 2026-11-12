import "server-only";
/**
 * Bulk publish, duplicate and archive. Each form goes through the SAME service
 * as the single-form routes (template-publish.ts, duplicate-template-service.ts),
 * with the same rules. Two extra guards apply only to bulk publish, because a
 * batch can do what no single click could:
 *
 *  - a form whose schema to publish has a validation ERROR is refused (fix it
 *    in the builder first);
 *  - two GLOBAL forms of the same job type in one batch are both refused:
 *    publishing one archives the other, so the outcome would depend on order.
 */
import { FormTemplateVersionKind, type JobType, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { checkTemplateSchema } from "./template-checks";
import { archiveFormTemplate, propertyScopedTemplateIds, publishFormTemplate } from "./template-publish";
import { duplicateFormTemplate } from "./duplicate-template-service";
import type { BulkFormOutcome } from "./template-bulk-types";

export type BulkTemplate = {
  id: string;
  name: string;
  serviceType: JobType;
  isActive: boolean;
  archivedAt: Date | null;
  isJobScoped: boolean;
  schema: Prisma.JsonValue;
  groupId: string | null;
  tags: string[];
  version: number;
};

type Options = { dryRun: boolean; actorId: string };

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not be completed.";
}

async function otherLiveGlobals(template: BulkTemplate, scoped: Set<string>): Promise<number> {
  return db.formTemplate.count({
    where: {
      serviceType: template.serviceType,
      isActive: true,
      isJobScoped: false,
      id: { notIn: [template.id, ...Array.from(scoped)] },
    },
  });
}

async function runPublish(templates: BulkTemplate[], options: Options): Promise<BulkFormOutcome[]> {
  const scoped = await propertyScopedTemplateIds();
  const drafts = await db.formTemplateVersion.findMany({
    where: { templateId: { in: templates.map((t) => t.id) }, kind: FormTemplateVersionKind.DRAFT },
    select: { templateId: true, schema: true },
  });
  const draftSchema = new Map(drafts.map((d) => [d.templateId, d.schema]));
  const publishable = templates.filter((t) => !t.archivedAt && (draftSchema.has(t.id) || !t.isActive));
  const globalsByType = new Map<string, number>();
  for (const t of publishable) {
    if (!t.isJobScoped && !scoped.has(t.id)) globalsByType.set(t.serviceType, (globalsByType.get(t.serviceType) ?? 0) + 1);
  }

  const outcomes: BulkFormOutcome[] = [];
  for (const template of templates) {
    const base = { templateId: template.id, name: template.name, changes: [] };
    const hasDraft = draftSchema.has(template.id);
    if (template.archivedAt) {
      outcomes.push({ ...base, status: "refused", reason: "Archived. Unarchive it before publishing." });
      continue;
    }
    if (template.isActive && !hasDraft) {
      outcomes.push({ ...base, status: "unchanged", reason: "Live with no unpublished changes." });
      continue;
    }
    const checks = checkTemplateSchema(draftSchema.get(template.id) ?? template.schema);
    if (checks.errors > 0) {
      outcomes.push({ ...base, status: "refused", reason: `${checks.errors} problem${checks.errors === 1 ? "" : "s"} to fix first: ${checks.issues.find((i) => i.severity === "error")?.message ?? ""}` });
      continue;
    }
    const isGlobal = !template.isJobScoped && !scoped.has(template.id);
    if (isGlobal && (globalsByType.get(template.serviceType) ?? 0) > 1) {
      outcomes.push({ ...base, status: "refused", reason: `Another selected form is also a default for ${template.serviceType.replace(/_/g, " ").toLowerCase()}; publish them one at a time.` });
      continue;
    }
    if (options.dryRun) {
      const replaced = isGlobal ? await otherLiveGlobals(template, scoped) : 0;
      outcomes.push({
        ...base,
        status: "would-change",
        reason: replaced > 0 ? `Becomes the default; ${replaced} other live form${replaced === 1 ? "" : "s"} for this job type will be archived.` : undefined,
        changes: [{
          sectionTitle: "",
          fieldId: null,
          fieldLabel: "(form)",
          property: hasDraft ? "version" : "status",
          before: hasDraft ? `v${template.version} live` : "draft",
          after: hasDraft ? "unpublished changes go live as a new version" : "live",
        }],
      });
      continue;
    }
    try {
      const result = await publishFormTemplate({ templateId: template.id, actorId: options.actorId });
      outcomes.push({ ...base, status: "changed", publishedVersion: result.publishedVersion, archivedPrevious: result.archivedPrevious });
    } catch (error) {
      outcomes.push({ ...base, status: "refused", reason: errorText(error) });
    }
  }
  return outcomes;
}

async function runDuplicate(templates: BulkTemplate[], options: Options): Promise<BulkFormOutcome[]> {
  const outcomes: BulkFormOutcome[] = [];
  for (const template of templates) {
    const base = { templateId: template.id, name: template.name, changes: [] };
    if (options.dryRun) {
      outcomes.push({ ...base, status: "would-change", reason: "A copy is created as an unpublished draft." });
      continue;
    }
    try {
      const copy = await duplicateFormTemplate(template.id);
      outcomes.push({ ...base, status: "changed", newTemplateId: copy.id, reason: `Copied as "${copy.name}" (draft).` });
    } catch (error) {
      outcomes.push({ ...base, status: "refused", reason: errorText(error) });
    }
  }
  return outcomes;
}

async function runArchive(templates: BulkTemplate[], options: Options): Promise<BulkFormOutcome[]> {
  const outcomes: BulkFormOutcome[] = [];
  for (const template of templates) {
    const base = { templateId: template.id, name: template.name, changes: [] };
    if (template.archivedAt) {
      outcomes.push({ ...base, status: "unchanged", reason: "Already archived." });
      continue;
    }
    const note = template.isActive ? "Live now: jobs stop using it." : undefined;
    if (options.dryRun) {
      outcomes.push({ ...base, status: "would-change", reason: note });
      continue;
    }
    try {
      await archiveFormTemplate(template.id);
      outcomes.push({ ...base, status: "changed", reason: note });
    } catch (error) {
      outcomes.push({ ...base, status: "refused", reason: errorText(error) });
    }
  }
  return outcomes;
}

export function runLifecycleOperation(
  templates: BulkTemplate[],
  type: "publish" | "duplicate" | "archive",
  options: Options,
): Promise<BulkFormOutcome[]> {
  if (type === "publish") return runPublish(templates, options);
  if (type === "duplicate") return runDuplicate(templates, options);
  return runArchive(templates, options);
}
