/**
 * Tolerant reader that turns ANY stored template schema (legacy or current)
 * into the typed FormSchema the builder edits. Never throws: a missing id is
 * backfilled deterministically, a missing type reads as text, a missing label
 * reads as "Field", and unknown keys are kept, so opening and saving an old
 * form never loses what it had. Canonicalisation (legacy `label`/`upload`/
 * `{ fieldId, equals }` shapes, standard sections) is normalizeFormSchema's,
 * the same function the cleaner read and submit routes use.
 */
import { normalizeFormSchema } from "./normalize-schema";
import type { FormField, FormSchema, FormSection } from "./types";

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toField(raw: unknown, sectionIndex: number, fieldIndex: number): FormField {
  const node = isNode(raw) ? raw : {};
  return {
    ...node,
    id: typeof node.id === "string" ? node.id : `f-${sectionIndex}-${fieldIndex}`,
    type: (typeof node.type === "string" ? node.type : "text") as FormField["type"],
    label: typeof node.label === "string" ? node.label : "Field",
  } as FormField;
}

function toSection(raw: unknown, index: number): FormSection {
  const node = isNode(raw) ? raw : {};
  const title = typeof node.title === "string" ? node.title : typeof node.label === "string" ? node.label : `Section ${index + 1}`;
  return {
    ...node,
    id: typeof node.id === "string" ? node.id : `s-${index}`,
    title,
    description: typeof node.description === "string" ? node.description : undefined,
    fields: Array.isArray(node.fields) ? node.fields.map((field, fieldIndex) => toField(field, index, fieldIndex)) : [],
  } as FormSection;
}

export function toEditableSchema(stored: unknown): FormSchema {
  const normalized = normalizeFormSchema(stored);
  const schema: FormSchema = {
    sections: (Array.isArray(normalized.sections) ? normalized.sections : []).map(toSection),
  };
  if (isNode(normalized.theme)) schema.theme = normalized.theme as FormSchema["theme"];
  // Template-level inventory selection and the standard-sections opt-out ride on
  // the root; dropping them here would silently undo them on the next save.
  if (normalized.inventoryConfig) schema.inventoryConfig = normalized.inventoryConfig;
  if (normalized.standardSections === false) schema.standardSections = false;
  return schema;
}
