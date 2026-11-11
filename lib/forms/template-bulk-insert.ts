/**
 * "Copy to other forms" and saved blocks: insert copies of questions into one
 * form's working copy. Used by the bulk service (operation
 * "insert-questions"), so a copy is previewed per form and saved as a DRAFT,
 * like every other bulk content edit.
 *
 *  - Every copied question and sub-question gets a new id that does not collide
 *    with any id in the target form.
 *  - A show/hide rule watching a question inside the copied set follows that
 *    question's copy; one watching a question outside the set is dropped and
 *    reported as a change ("rule dropped"), never left dangling.
 *  - The copies go into the target section with the same title (matched
 *    without case), or a new section with that title before the standard
 *    sign-off sections.
 *
 * PURE: no database.
 */
import { copyFieldsWithNewIds, type IdFactory } from "./builder-ops";
import { guardNewErrors, type EditOutcome, type FieldChange } from "./template-bulk-edits";
import { STANDARD_SECTION_IDS } from "./standard-sections";
import { isNode, sectionTitleOf, type SchemaNode } from "./template-questions";
import type { FormField } from "./types";

export type InsertQuestionsInput = {
  sectionTitle: string;
  fields: FormField[];
};

function idsIn(schema: SchemaNode): Set<string> {
  const ids = new Set<string>();
  const sections = Array.isArray(schema.sections) ? schema.sections.filter(isNode) : [];
  for (const section of sections) {
    if (typeof section.id === "string") ids.add(section.id);
    for (const field of Array.isArray(section.fields) ? section.fields.filter(isNode) : []) {
      if (typeof field.id === "string") ids.add(field.id);
      for (const child of Array.isArray(field.children) ? field.children.filter(isNode) : []) {
        if (typeof child.id === "string") ids.add(child.id);
      }
    }
  }
  return ids;
}

function collisionFreeFactory(taken: Set<string>): IdFactory {
  let n = 0;
  return (kind) => {
    let candidate = "";
    do {
      n += 1;
      candidate = `${kind === "field" ? "f" : "s"}-copy-${Date.now().toString(36)}-${n}`;
    } while (taken.has(candidate));
    taken.add(candidate);
    return candidate;
  };
}

function standardTailIndex(sections: unknown[]): number {
  const isStandard = (s: unknown) => isNode(s) && (STANDARD_SECTION_IDS as readonly unknown[]).includes(s.id);
  let index = sections.length;
  while (index > 0 && isStandard(sections[index - 1]) && index - 1 > 0) index -= 1;
  return index;
}

export function insertQuestions(schema: unknown, input: InsertQuestionsInput): EditOutcome {
  if (input.fields.length === 0) return { changed: false, reason: "No questions to copy." };
  const copy = structuredClone(isNode(schema) ? schema : { sections: [] }) as SchemaNode;
  const sections: unknown[] = Array.isArray(copy.sections) ? copy.sections : [];
  const taken = idsIn(copy);
  const makeId = collisionFreeFactory(taken);
  const { fields, droppedRules } = copyFieldsWithNewIds(input.fields, makeId);
  const title = input.sectionTitle.trim() || "Copied questions";

  let target = sections.find((s): s is SchemaNode => isNode(s) && sectionTitleOf(s).toLowerCase() === title.toLowerCase());
  if (!target) {
    target = { id: makeId("section"), title, fields: [] };
    sections.splice(standardTailIndex(sections), 0, target);
  }
  const existing = Array.isArray(target.fields) ? target.fields : [];
  target.fields = [...existing, ...fields];
  copy.sections = sections;

  const changes: FieldChange[] = [
    ...fields.map((field) => ({
      sectionTitle: title,
      fieldId: field.id,
      fieldLabel: field.label,
      property: "question",
      before: null,
      after: field.label,
    })),
    ...droppedRules.map((rule) => ({
      sectionTitle: title,
      fieldId: null,
      fieldLabel: rule.questionLabel,
      property: "rule dropped",
      before: `shown only when another question (${rule.watchedFieldId}) is answered`,
      after: "always shown",
    })),
  ];
  return guardNewErrors(schema, { changed: true, schema: copy, changes });
}
