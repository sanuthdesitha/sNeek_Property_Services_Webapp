import "server-only";
/**
 * The forms library's bulk operations. One request, one outcome per form.
 *
 *  - Content edits (edit-question, add-section, find-replace) are applied to
 *    each form's working copy (its draft, else its live schema) and SAVED AS
 *    DRAFTS. The live schema — what jobs resolve to and cleaners fill in — is
 *    not touched until the form is published.
 *  - move-to-group and set-tags change library organisation only.
 *  - publish, duplicate and archive call the same services as the single-form
 *    routes (template-bulk-lifecycle.ts).
 *  - dryRun: true changes nothing and returns what each form would get.
 *
 * Forms run one after another; a failure on one form is reported for that form
 * and does not stop the rest. A refused or unchanged form is never counted as
 * done.
 */
import { FormTemplateVersionKind, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addSection, editQuestion, findAndReplace, type EditOutcome } from "./template-bulk-edits";
import { insertQuestions } from "./template-bulk-insert";
import type { FormField } from "./types";
import { saveTemplateDraft } from "./template-drafts";
import { runLifecycleOperation, type BulkTemplate } from "./template-bulk-lifecycle";
import type { BulkFormOutcome, BulkOperation, BulkResponse } from "./template-bulk-types";

type ContentOperation = Extract<BulkOperation, { type: "edit-question" | "add-section" | "find-replace" | "insert-questions" }>;

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  serviceType: true,
  isActive: true,
  archivedAt: true,
  isJobScoped: true,
  schema: true,
  groupId: true,
  tags: true,
  version: true,
} satisfies Prisma.FormTemplateSelect;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not be saved.";
}

function applyContent(schema: unknown, operation: ContentOperation): EditOutcome {
  if (operation.type === "edit-question") return editQuestion(schema, operation.match, operation.edit);
  if (operation.type === "add-section") return addSection(schema, operation.section);
  if (operation.type === "insert-questions") {
    return insertQuestions(schema, { sectionTitle: operation.sectionTitle, fields: operation.fields as unknown as FormField[] });
  }
  return findAndReplace(schema, operation);
}

async function runContent(
  templates: BulkTemplate[],
  operation: ContentOperation,
  options: { dryRun: boolean; actorId: string; note?: string },
): Promise<BulkFormOutcome[]> {
  const drafts = await db.formTemplateVersion.findMany({
    where: { templateId: { in: templates.map((t) => t.id) }, kind: FormTemplateVersionKind.DRAFT },
    select: { templateId: true, schema: true },
  });
  const draftSchema = new Map(drafts.map((d) => [d.templateId, d.schema]));
  const outcomes: BulkFormOutcome[] = [];
  for (const template of templates) {
    const base = { templateId: template.id, name: template.name, changes: [] };
    if (template.archivedAt) {
      outcomes.push({ ...base, status: "refused", reason: "Archived. Unarchive it before changing it." });
      continue;
    }
    const edited = applyContent(draftSchema.get(template.id) ?? template.schema, operation);
    if (!edited.changed) {
      outcomes.push({ ...base, status: "unchanged", reason: edited.reason });
      continue;
    }
    if (options.dryRun) {
      outcomes.push({ ...base, status: "would-change", changes: edited.changes });
      continue;
    }
    try {
      await saveTemplateDraft({ templateId: template.id, schema: edited.schema, actorId: options.actorId, note: options.note });
      outcomes.push({ ...base, status: "changed", changes: edited.changes, draftSaved: true });
    } catch (error) {
      outcomes.push({ ...base, status: "refused", reason: errorText(error) });
    }
  }
  return outcomes;
}

async function runMoveToGroup(templates: BulkTemplate[], groupId: string | null, dryRun: boolean): Promise<BulkFormOutcome[]> {
  const group = groupId ? await db.formTemplateGroup.findUnique({ where: { id: groupId }, select: { id: true, name: true } }) : null;
  const target = group?.name ?? "No group";
  const outcomes: BulkFormOutcome[] = [];
  for (const template of templates) {
    const base = { templateId: template.id, name: template.name, changes: [] };
    if (groupId && !group) {
      outcomes.push({ ...base, status: "refused", reason: "That group no longer exists." });
      continue;
    }
    if (template.groupId === groupId) {
      outcomes.push({ ...base, status: "unchanged", reason: `Already in ${target}.` });
      continue;
    }
    const changes = [{ sectionTitle: "", fieldId: null, fieldLabel: "(form)", property: "group", before: template.groupId, after: target }];
    if (!dryRun) await db.formTemplate.update({ where: { id: template.id }, data: { groupId } });
    outcomes.push({ ...base, status: dryRun ? "would-change" : "changed", changes });
  }
  return outcomes;
}

async function runSetTags(templates: BulkTemplate[], add: string[], remove: string[], dryRun: boolean): Promise<BulkFormOutcome[]> {
  const removeSet = new Set(remove.map((tag) => tag.trim().toLowerCase()));
  const outcomes: BulkFormOutcome[] = [];
  for (const template of templates) {
    const base = { templateId: template.id, name: template.name, changes: [] };
    const before = template.tags ?? [];
    const kept = before.filter((tag) => !removeSet.has(tag.toLowerCase()));
    const after = Array.from(new Set([...kept, ...add.map((tag) => tag.trim())])).slice(0, 20);
    if (JSON.stringify(after) === JSON.stringify(before)) {
      outcomes.push({ ...base, status: "unchanged", reason: "Tags already match." });
      continue;
    }
    if (!dryRun) await db.formTemplate.update({ where: { id: template.id }, data: { tags: after } });
    outcomes.push({
      ...base,
      status: dryRun ? "would-change" : "changed",
      changes: [{ sectionTitle: "", fieldId: null, fieldLabel: "(form)", property: "tags", before, after }],
    });
  }
  return outcomes;
}

function summarise(outcomes: BulkFormOutcome[]): BulkResponse["summary"] {
  return {
    changed: outcomes.filter((o) => o.status === "changed" || o.status === "would-change").length,
    unchanged: outcomes.filter((o) => o.status === "unchanged").length,
    refused: outcomes.filter((o) => o.status === "refused").length,
  };
}

export async function runBulkTemplateOperation(input: {
  templateIds: string[];
  operation: BulkOperation;
  dryRun: boolean;
  actorId: string;
  note?: string;
}): Promise<BulkResponse> {
  const ids = Array.from(new Set(input.templateIds));
  const found = await db.formTemplate.findMany({ where: { id: { in: ids } }, select: TEMPLATE_SELECT });
  const byId = new Map(found.map((t) => [t.id, t]));
  const templates = ids.map((id) => byId.get(id)).filter((t): t is BulkTemplate => Boolean(t));
  const missing: BulkFormOutcome[] = ids
    .filter((id) => !byId.has(id))
    .map((id) => ({ templateId: id, name: id, status: "refused", reason: "Form not found.", changes: [] }));

  const { operation, dryRun } = input;
  let outcomes: BulkFormOutcome[];
  if (
    operation.type === "edit-question" ||
    operation.type === "add-section" ||
    operation.type === "find-replace" ||
    operation.type === "insert-questions"
  ) {
    outcomes = await runContent(templates, operation, { dryRun, actorId: input.actorId, note: input.note });
  } else if (operation.type === "move-to-group") {
    outcomes = await runMoveToGroup(templates, operation.groupId, dryRun);
  } else if (operation.type === "set-tags") {
    outcomes = await runSetTags(templates, operation.add, operation.remove, dryRun);
  } else {
    outcomes = await runLifecycleOperation(templates, operation.type, { dryRun, actorId: input.actorId });
  }
  const all = [...outcomes, ...missing];
  if (!dryRun && all.some((o) => o.status === "changed")) {
    await db.auditLog.create({
      data: {
        userId: input.actorId,
        action: "BULK_FORM_TEMPLATES",
        entity: "FormTemplate",
        entityId: all.filter((o) => o.status === "changed").map((o) => o.templateId).join(",").slice(0, 1000),
        after: { operation: operation.type, outcomes: all.map((o) => ({ id: o.templateId, status: o.status, reason: o.reason ?? null })) },
      },
    });
  }
  return { dryRun, operation: operation.type, outcomes: all, summary: summarise(all) };
}
