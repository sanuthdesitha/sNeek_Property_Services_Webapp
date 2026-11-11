/**
 * Pure schema operations behind the form builder: reorder and move sections
 * and questions (drag and drop and the keyboard menu use the same functions),
 * duplicate, delete, and copy a set of questions with fresh ids.
 *
 * Every function returns a NEW schema and never mutates its input, so the
 * builder's undo history can keep earlier states by reference.
 */
import type { FormCondition, FormField, FormSchema, FormSection } from "./types";
import { isAnswerCondition } from "./types";

export type IdFactory = (kind: "field" | "section") => string;

let counter = 0;
/** Default id factory: unique within a session, readable in the stored schema. */
export const defaultIdFactory: IdFactory = (kind) => {
  counter += 1;
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${kind === "field" ? "f" : "s"}-${stamp}${counter.toString(36)}-${random}`;
};

export type FieldLocation = { sectionIndex: number; fieldIndex: number; section: FormSection; field: FormField };

export function locateField(schema: FormSchema, fieldId: string): FieldLocation | null {
  for (let sectionIndex = 0; sectionIndex < schema.sections.length; sectionIndex += 1) {
    const section = schema.sections[sectionIndex];
    const fieldIndex = section.fields.findIndex((field) => field.id === fieldId);
    if (fieldIndex !== -1) return { sectionIndex, fieldIndex, section, field: section.fields[fieldIndex] };
  }
  return null;
}

export function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

function withSections(schema: FormSchema, sections: FormSection[]): FormSchema {
  return { ...schema, sections };
}

/* ── Sections ─────────────────────────────────────────────────────────── */

/** Move a section to the position of another (drag and drop). */
export function reorderSection(schema: FormSchema, activeId: string, overId: string): FormSchema {
  const from = schema.sections.findIndex((section) => section.id === activeId);
  const to = schema.sections.findIndex((section) => section.id === overId);
  if (from === -1 || to === -1 || from === to) return schema;
  return withSections(schema, arrayMove(schema.sections, from, to));
}

/** Move a section one place up (-1) or down (+1). */
export function moveSectionBy(schema: FormSchema, sectionId: string, direction: -1 | 1): FormSchema {
  const from = schema.sections.findIndex((section) => section.id === sectionId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= schema.sections.length) return schema;
  return withSections(schema, arrayMove(schema.sections, from, to));
}

/* ── Questions ────────────────────────────────────────────────────────── */

/** Reorder a question within its section (drag and drop onto another question). */
export function reorderField(schema: FormSchema, activeId: string, overId: string): FormSchema {
  const active = locateField(schema, activeId);
  const over = locateField(schema, overId);
  if (!active || !over || activeId === overId) return schema;
  if (active.sectionIndex !== over.sectionIndex) {
    return moveFieldsToSection(schema, [activeId], over.section.id, over.fieldIndex);
  }
  const sections = schema.sections.slice();
  sections[active.sectionIndex] = {
    ...active.section,
    fields: arrayMove(active.section.fields, active.fieldIndex, over.fieldIndex),
  };
  return withSections(schema, sections);
}

/** Move a question one place up or down within its section. */
export function moveFieldBy(schema: FormSchema, fieldId: string, direction: -1 | 1): FormSchema {
  const at = locateField(schema, fieldId);
  if (!at) return schema;
  const to = at.fieldIndex + direction;
  if (to < 0 || to >= at.section.fields.length) return schema;
  const sections = schema.sections.slice();
  sections[at.sectionIndex] = { ...at.section, fields: arrayMove(at.section.fields, at.fieldIndex, to) };
  return withSections(schema, sections);
}

/**
 * Move questions (kept in their current document order) into another section,
 * at `index` (default: the end). Questions already in the target keep their
 * relative order. Unknown ids are ignored.
 */
export function moveFieldsToSection(schema: FormSchema, fieldIds: readonly string[], targetSectionId: string, index?: number): FormSchema {
  const target = schema.sections.find((section) => section.id === targetSectionId);
  if (!target) return schema;
  const wanted = new Set(fieldIds);
  const moving: FormField[] = [];
  for (const section of schema.sections) {
    for (const field of section.fields) if (wanted.has(field.id)) moving.push(field);
  }
  if (moving.length === 0) return schema;
  const sections = schema.sections.map((section) => ({
    ...section,
    fields: section.fields.filter((field) => !wanted.has(field.id)),
  }));
  const targetIndex = sections.findIndex((section) => section.id === targetSectionId);
  const remaining = sections[targetIndex].fields;
  const at = index === undefined ? remaining.length : Math.max(0, Math.min(index, remaining.length));
  sections[targetIndex] = {
    ...sections[targetIndex],
    fields: [...remaining.slice(0, at), ...moving, ...remaining.slice(at)],
  };
  return withSections(schema, sections);
}

/** Remove questions. Returns the schema and the questions whose rules now point at nothing. */
export function deleteFields(schema: FormSchema, fieldIds: readonly string[]): { schema: FormSchema; danglingRuleLabels: string[] } {
  const removing = new Set(fieldIds);
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (removing.has(field.id)) for (const child of field.children ?? []) removing.add(child.id);
    }
  }
  const sections = schema.sections.map((section) => ({
    ...section,
    fields: section.fields.filter((field) => !fieldIds.includes(field.id)),
  }));
  const danglingRuleLabels: string[] = [];
  const check = (node: { label?: string; title?: string; conditional?: FormCondition }) => {
    const rule = node.conditional;
    if (isAnswerCondition(rule) && removing.has(rule.fieldId)) danglingRuleLabels.push(node.label ?? node.title ?? "Section");
  };
  for (const section of sections) {
    check(section);
    for (const field of section.fields) {
      check(field);
      for (const child of field.children ?? []) check(child);
    }
  }
  return { schema: withSections(schema, sections), danglingRuleLabels };
}

/* ── Copying with fresh ids ───────────────────────────────────────────── */

export type DroppedRule = { questionLabel: string; watchedFieldId: string };

export type CopiedFields = {
  fields: FormField[];
  /** Rules removed because the question they watch was not copied. */
  droppedRules: DroppedRule[];
};

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Copy questions with new ids for every question and sub-question. A rule that
 * watches another question in the copied set is re-pointed at that question's
 * copy; a rule that watches a question outside the set is DROPPED (never left
 * dangling) and reported. Property rules are kept as they are.
 */
export function copyFieldsWithNewIds(source: readonly FormField[], makeId: IdFactory = defaultIdFactory): CopiedFields {
  const idMap = new Map<string, string>();
  for (const field of source) {
    idMap.set(field.id, makeId("field"));
    for (const child of field.children ?? []) idMap.set(child.id, makeId("field"));
  }
  const droppedRules: DroppedRule[] = [];
  const remap = (field: FormField): FormField => {
    const copy = deepCopy(field);
    copy.id = idMap.get(field.id) ?? makeId("field");
    const rule = copy.conditional;
    if (isAnswerCondition(rule)) {
      const mapped = idMap.get(rule.fieldId);
      if (mapped) copy.conditional = { ...rule, fieldId: mapped };
      else {
        droppedRules.push({ questionLabel: field.label, watchedFieldId: rule.fieldId });
        delete copy.conditional;
      }
    }
    if (field.children) copy.children = field.children.map(remap);
    return copy;
  };
  return { fields: source.map(remap), droppedRules };
}

/** Duplicate questions in place: each copy sits right after its original. */
export function duplicateFields(schema: FormSchema, fieldIds: readonly string[], makeId: IdFactory = defaultIdFactory): { schema: FormSchema; newIds: string[] } {
  const wanted = new Set(fieldIds);
  const ordered = schema.sections.flatMap((section) => section.fields.filter((field) => wanted.has(field.id)));
  const { fields: copies } = copyFieldsWithNewIds(ordered, makeId);
  // Rules watching a question OUTSIDE the duplicated set still make sense in the
  // same form, so restore them for an in-place duplicate.
  const restoreRule = (copy: FormField, original: FormField): FormField => {
    const next = !copy.conditional && original.conditional ? { ...copy, conditional: deepCopy(original.conditional) } : copy;
    if (next.children && original.children) {
      return { ...next, children: next.children.map((child, index) => restoreRule(child, original.children![index])) };
    }
    return next;
  };
  const restored = copies.map((copy, index) => restoreRule(copy, ordered[index]));
  const copyFor = new Map(ordered.map((field, index) => [field.id, restored[index]]));
  const sections = schema.sections.map((section) => ({
    ...section,
    fields: section.fields.flatMap((field) => {
      const copy = copyFor.get(field.id);
      return copy ? [field, { ...copy, label: ordered.length === 1 ? `${field.label} (copy)` : field.label }] : [field];
    }),
  }));
  // Nothing is dropped in place: every rule either moved to a copy or was restored.
  return { schema: withSections(schema, sections), newIds: restored.map((copy) => copy.id) };
}

/** Insert questions at the end of a section (saved blocks, "add a question"). */
export function insertFields(schema: FormSchema, sectionId: string, fields: readonly FormField[], index?: number): FormSchema {
  return withSections(
    schema,
    schema.sections.map((section) => {
      if (section.id !== sectionId) return section;
      const at = index === undefined ? section.fields.length : Math.max(0, Math.min(index, section.fields.length));
      return { ...section, fields: [...section.fields.slice(0, at), ...fields, ...section.fields.slice(at)] };
    }),
  );
}

/** Replace one question by id (wherever it is). */
export function replaceField(schema: FormSchema, fieldId: string, next: FormField): FormSchema {
  return withSections(
    schema,
    schema.sections.map((section) =>
      section.fields.some((field) => field.id === fieldId)
        ? { ...section, fields: section.fields.map((field) => (field.id === fieldId ? next : field)) }
        : section,
    ),
  );
}

/** Replace one section by id. */
export function updateSection(schema: FormSchema, sectionId: string, patch: (section: FormSection) => FormSection): FormSchema {
  return withSections(schema, schema.sections.map((section) => (section.id === sectionId ? patch(section) : section)));
}

/** Every question id in document order (sub-questions excluded). */
export function fieldIdsInOrder(schema: FormSchema): string[] {
  return schema.sections.flatMap((section) => section.fields.map((field) => field.id));
}
