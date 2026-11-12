/**
 * Content edits the forms library applies to many templates at once. Each
 * function takes ONE schema and returns either the edited copy with a list of
 * before/after changes, or the reason the form was left alone.
 *
 * Rules shared by every edit:
 *  - The input is never mutated (a deep copy is edited).
 *  - Field and section ids are never changed; new sections and questions get
 *    fresh ids that do not collide with any id in the form.
 *  - An edit that would add a validation ERROR the form did not already have
 *    is refused for that form (see `guardNewErrors`).
 *
 * PURE: no database.
 */
import { checkTemplateSchema } from "./template-checks";
import { isUploadFieldType } from "./field-types";
import { STANDARD_SECTION_IDS } from "./standard-sections";
import { findQuestion, isNode, listQuestions, schemaSections, sectionTitleOf, type QuestionMatch, type SchemaNode } from "./template-questions";

export type FieldChange = {
  sectionTitle: string;
  fieldId: string | null;
  fieldLabel: string;
  property: string;
  before: unknown;
  after: unknown;
};

export type EditOutcome =
  | { changed: true; schema: SchemaNode; changes: FieldChange[] }
  | { changed: false; reason: string };

export const EDITABLE_QUESTION_PROPERTIES = [
  "label",
  "helpText",
  "required",
  "minPhotos",
  "maxFiles",
  "severity",
  "detailsWhenNo",
] as const;
export type EditableQuestionProperty = (typeof EDITABLE_QUESTION_PROPERTIES)[number];

export type QuestionEdit =
  | { property: "label"; value: string }
  | { property: "helpText"; value: string }
  | { property: "required"; value: boolean }
  | { property: "minPhotos"; value: number }
  | { property: "maxFiles"; value: number }
  | { property: "severity"; value: "low" | "medium" | "high" | null }
  | { property: "detailsWhenNo"; value: boolean };

export type AddSectionInput = {
  title: string;
  description?: string;
  /** One tick-box question per entry. */
  questions: string[];
  position: "start" | "end";
};

export type FindReplaceInput = { find: string; replace: string; matchCase: boolean };

function clone(schema: unknown): SchemaNode {
  return structuredClone(isNode(schema) ? schema : { sections: [] }) as SchemaNode;
}

function errorMessages(schema: unknown): Set<string> {
  return new Set(checkTemplateSchema(schema).issues.filter((i) => i.severity === "error").map((i) => i.message));
}

/** Refuse an edit that introduces a validation error the form did not have. */
export function guardNewErrors(before: unknown, outcome: EditOutcome): EditOutcome {
  if (!outcome.changed) return outcome;
  const existing = errorMessages(before);
  const added = Array.from(errorMessages(outcome.schema)).filter((message) => !existing.has(message));
  if (added.length === 0) return outcome;
  return { changed: false, reason: `This change would add a problem: ${added[0]}` };
}

function questionApplies(field: SchemaNode, edit: QuestionEdit): string | null {
  const type = String(field.type ?? "");
  if ((edit.property === "minPhotos" || edit.property === "maxFiles") && !isUploadFieldType(type)) {
    return `"${String(field.label ?? "")}" is a ${type} question; it takes no photos.`;
  }
  if (edit.property === "detailsWhenNo" && type !== "yesno") {
    return `"${String(field.label ?? "")}" is not a yes/no question.`;
  }
  return null;
}

function setOrDelete(field: SchemaNode, key: string, value: unknown) {
  if (value === null || value === "" || value === undefined) delete field[key];
  else field[key] = value;
}

export function editQuestion(schema: unknown, match: QuestionMatch, edit: QuestionEdit): EditOutcome {
  const copy = clone(schema);
  const found = findQuestion(copy, match);
  if (!found.ok) return { changed: false, reason: found.reason };
  const { field, sectionTitle } = found.location;
  const notApplicable = questionApplies(field, edit);
  if (notApplicable) return { changed: false, reason: notApplicable };
  const before = field[edit.property] ?? null;
  const after = edit.value === "" ? null : edit.value;
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return { changed: false, reason: "Already set to that value." };
  }
  setOrDelete(field, edit.property, after);
  const change: FieldChange = {
    sectionTitle,
    fieldId: typeof field.id === "string" ? field.id : null,
    fieldLabel: String(field.label ?? ""),
    property: edit.property,
    before,
    after,
  };
  return guardNewErrors(schema, { changed: true, schema: copy, changes: [change] });
}

function collectIds(schema: SchemaNode): Set<string> {
  const ids = new Set<string>();
  for (const section of schemaSections(schema)) {
    if (typeof section.id === "string") ids.add(section.id);
  }
  for (const question of listQuestions(schema)) {
    if (typeof question.field.id === "string") ids.add(question.field.id);
  }
  return ids;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "section";
}

function freshId(base: string, taken: Set<string>): string {
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`;
  taken.add(candidate);
  return candidate;
}

function insertionIndex(sections: unknown[], position: "start" | "end"): number {
  const isStandard = (s: unknown) => isNode(s) && (STANDARD_SECTION_IDS as readonly unknown[]).includes(s.id);
  if (position === "start") return sections.length > 0 && isStandard(sections[0]) ? 1 : 0;
  let index = sections.length;
  while (index > 0 && isStandard(sections[index - 1]) && sections[index - 1] !== sections[0]) index -= 1;
  return index;
}

export function addSection(schema: unknown, input: AddSectionInput): EditOutcome {
  const copy = clone(schema);
  const sections = Array.isArray(copy.sections) ? copy.sections : [];
  const title = input.title.trim();
  if (sections.some((s) => isNode(s) && sectionTitleOf(s).toLowerCase() === title.toLowerCase())) {
    return { changed: false, reason: `This form already has a section called "${title}".` };
  }
  const taken = collectIds(copy);
  const sectionId = freshId(`s-${slug(title)}`, taken);
  const fields = input.questions
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label) => ({ id: freshId(`f-${slug(label)}`, taken), type: "checkbox", label, required: true }));
  const section: SchemaNode = { id: sectionId, title, fields };
  if (input.description?.trim()) section.description = input.description.trim();
  sections.splice(insertionIndex(sections, input.position), 0, section);
  copy.sections = sections;
  const changes: FieldChange[] = [
    { sectionTitle: title, fieldId: null, fieldLabel: "(new section)", property: "section", before: null, after: title },
    ...fields.map((f) => ({ sectionTitle: title, fieldId: f.id, fieldLabel: f.label, property: "question", before: null, after: f.label })),
  ];
  return guardNewErrors(schema, { changed: true, schema: copy, changes });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TEXT_KEYS = ["label", "helpText", "instructions", "placeholder"] as const;

/** Values conditions compare against; renaming one would orphan the condition. */
function conditionValues(schema: SchemaNode): Set<string> {
  const values = new Set<string>();
  const visit = (node: SchemaNode) => {
    const cond = node.conditional;
    if (!isNode(cond)) return;
    for (const raw of [cond.value, cond.equals]) {
      for (const value of Array.isArray(raw) ? raw : [raw]) if (typeof value === "string") values.add(value);
    }
  };
  for (const section of schemaSections(schema)) visit(section);
  for (const question of listQuestions(schema)) visit(question.field);
  return values;
}

/** Labels, descriptions, help text and options only. Ids and values are never touched. */
export function findAndReplace(schema: unknown, input: FindReplaceInput): EditOutcome {
  if (!input.find) return { changed: false, reason: "Nothing to find." };
  const copy = clone(schema);
  const pattern = new RegExp(escapeRegExp(input.find), input.matchCase ? "g" : "gi");
  const changes: FieldChange[] = [];
  const guardedValues = conditionValues(copy);
  let refusal: string | null = null;

  const replaceIn = (node: SchemaNode, key: string, sectionTitle: string, label: string) => {
    const before = node[key];
    if (typeof before !== "string" || !pattern.test(before)) return;
    pattern.lastIndex = 0;
    const after = before.replace(pattern, input.replace);
    node[key] = after;
    changes.push({ sectionTitle, fieldId: typeof node.id === "string" ? node.id : null, fieldLabel: label, property: key, before, after });
  };

  for (const section of schemaSections(copy)) {
    const title = sectionTitleOf(section);
    for (const key of ["title", "label", "description"]) replaceIn(section, key, title, "(section)");
  }
  for (const question of listQuestions(copy)) {
    const { field } = question;
    const label = String(field.label ?? "");
    for (const key of TEXT_KEYS) replaceIn(field, key, question.sectionTitle, label);
    if (Array.isArray(field.options)) {
      const before = field.options;
      const after = before.map((option) => (typeof option === "string" ? option.replace(pattern, input.replace) : option));
      const renamed = before.filter((option, i) => option !== after[i]);
      const orphaned = renamed.find((option) => typeof option === "string" && guardedValues.has(option));
      if (orphaned !== undefined) refusal = `The option "${String(orphaned)}" is used by a condition; change it in the builder.`;
      if (renamed.length > 0) {
        field.options = after;
        changes.push({ sectionTitle: question.sectionTitle, fieldId: typeof field.id === "string" ? field.id : null, fieldLabel: String(field.label ?? label), property: "options", before, after });
      }
    }
  }
  if (refusal) return { changed: false, reason: refusal };
  if (changes.length === 0) return { changed: false, reason: `"${input.find}" does not appear in this form.` };
  return guardNewErrors(schema, { changed: true, schema: copy, changes });
}
