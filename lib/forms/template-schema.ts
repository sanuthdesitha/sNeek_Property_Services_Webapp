// Zod validation for FormTemplate.schema JSON. Intentionally permissive
// (passthrough) so legacy templates and forward-compatible props keep saving;
// it only enforces the structural invariants every renderer relies on:
// sections is an array, every section/field has a string id, fields is an
// array, and sub-fields (children) are one level deep with the same shape.

import { z } from "zod";
import { FIELD_TYPES } from "./field-types";
import { jobFormPropertySelect } from "./job-form-property";
import { duplicateStockCountItems, structuredFieldFindings } from "./structured-schema-checks";
import type { FieldConditionOperator, FieldFrequency, SectionRepeatBy } from "./types";

const conditionZ = z
  .object({
    fieldId: z.string().optional(),
    propertyField: z.string().optional(),
    operator: z.string().optional(),
    value: z.unknown().optional(),
    equals: z.unknown().optional(),
  })
  .passthrough();

function hasGrandchildren(child: unknown): boolean {
  const children = (child as { children?: unknown }).children;
  return Array.isArray(children) && children.length > 0;
}

const childFieldZ = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    label: z.string(),
    required: z.boolean().optional(),
    conditional: conditionZ.optional(),
  })
  .passthrough();

const fieldZ = childFieldZ.extend({
  // One level deep only: children may not have children of their own.
  children: z
    .array(childFieldZ.refine((c) => !hasGrandchildren(c), {
      message: "Sub-fields cannot have their own sub-fields (one level deep only).",
    }))
    .optional(),
});

const sectionZ = z
  .object({
    id: z.string().min(1),
    // Legacy templates use `label`, the modern builder uses `title` — one of
    // the two must exist but neither is individually required.
    title: z.string().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    conditional: conditionZ.optional(),
    fields: z.array(fieldZ),
  })
  .passthrough();

// Optional appearance overrides (schema.theme). All fields optional so legacy
// templates and forward-compatible props keep validating; passthrough lets new
// theme keys land without a schema bump.
const themeZ = z
  .object({
    accentColor: z.string().optional(),
    headerColor: z.string().optional(),
    logoUrl: z.string().optional(),
    logoKey: z.string().optional(),
    showDividers: z.boolean().optional(),
    headingFont: z.string().optional(),
    bodyFont: z.string().optional(),
  })
  .passthrough();

export const formTemplateSchemaZ = z
  .object({
    sections: z.array(sectionZ),
    theme: themeZ.optional(),
  })
  .passthrough();

export type ValidatedFormTemplateSchema = z.infer<typeof formTemplateSchemaZ>;

/* ── Strict save-time validation ──────────────────────────────────────────
 *
 * `formTemplateSchemaZ` above stays the TOLERANT reader: every schema already
 * stored keeps loading and rendering, however old. Saving a draft or
 * publishing additionally runs `validateFormSchemaForSave`, which refuses what
 * no renderer can honour: a question type that is not in the registry (typos,
 * types that were never built), a malformed condition, a property condition on
 * a key the cleaner payload does not carry, a cadence or per-room repeat value
 * the runtime does not understand.
 */

/**
 * Historical type names still found in stored templates. `upload` and
 * `textarea` are rewritten by normalizeFormSchema; `inventory` and
 * `laundry_confirm` come from the original seed and render as a plain text
 * answer. They are accepted on save so an old form can still be edited; the
 * checks flag them so they can be replaced.
 */
export const LEGACY_SAVE_FIELD_TYPES: ReadonlySet<string> = new Set(["upload", "textarea", "inventory", "laundry_confirm"]);

export const CONDITION_OPERATORS: ReadonlySet<FieldConditionOperator> = new Set<FieldConditionOperator>([
  "equals",
  "notEquals",
  "answered",
  "notAnswered",
  "contains",
  "notContains",
  "oneOf",
  "gt",
  "lt",
]);

const FREQUENCIES: ReadonlySet<FieldFrequency> = new Set<FieldFrequency>(["EVERY_CLEAN", "ROTATIONAL", "CONDITIONAL", "MONTHLY"]);
const REPEAT_BY: ReadonlySet<SectionRepeatBy> = new Set<SectionRepeatBy>(["bedrooms", "bathrooms"]);
const REPEAT_SUFFIX = /__(?:bed|bath)\d+$/;
const MAX_SAVE_ISSUES = 20;

export type SchemaSaveIssue = { path: string; message: string };
export type SchemaSaveResult = { ok: true; issues: [] } | { ok: false; issues: SchemaSaveIssue[] };

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isKnownFieldType(type: unknown): boolean {
  return typeof type === "string" && (Object.hasOwn(FIELD_TYPES, type) || LEGACY_SAVE_FIELD_TYPES.has(type));
}

/** Property keys a property condition may read (the cleaner-visible projection). */
export function isSupportedPropertyConditionKey(key: unknown): boolean {
  return typeof key === "string" && Object.hasOwn(jobFormPropertySelect, key);
}

export function conditionIssue(condition: unknown): string | null {
  if (condition === undefined || condition === null) return null;
  if (!isNode(condition)) return "The show/hide rule is not an object.";
  const hasField = "fieldId" in condition;
  const hasProperty = "propertyField" in condition;
  if (hasField && hasProperty) return "A show/hide rule watches either a question or the property, not both.";
  if (!hasField && !hasProperty) return "The show/hide rule does not say what it watches.";
  if (hasProperty) {
    if (!isSupportedPropertyConditionKey(condition.propertyField)) {
      return `The property rule reads "${String(condition.propertyField)}", which cleaners' forms do not receive.`;
    }
    if (condition.operator !== undefined && condition.operator !== "equals") {
      return "A property rule can only compare for equality.";
    }
    return null;
  }
  if (typeof condition.fieldId !== "string" || !condition.fieldId.trim()) return "The show/hide rule has no question.";
  if (condition.operator !== undefined && !CONDITION_OPERATORS.has(condition.operator as FieldConditionOperator)) {
    return `The show/hide rule uses an unknown comparison (${String(condition.operator)}).`;
  }
  return null;
}

export type SchemaSaveOptions = {
  /**
   * Keep a question whose setup is still being finished (structured-schema-
   * checks `incomplete`: a Stock count with no item chosen yet, a choice
   * column with no choices yet, …). Only the builder's draft autosave passes
   * it; the Checks still show these as errors and publishing refuses them.
   */
  allowIncomplete?: boolean;
};

function fieldIssues(field: Node, path: string, repeated: boolean, out: SchemaSaveIssue[], options: SchemaSaveOptions): void {
  const name = typeof field.label === "string" && field.label.trim() ? `"${field.label.trim()}"` : String(field.id ?? "question");
  if (!isKnownFieldType(field.type)) {
    out.push({ path, message: `${name} has a question type no form can show (${String(field.type ?? "none")}).` });
  }
  const condition = conditionIssue(field.conditional);
  if (condition) out.push({ path: `${path}.conditional`, message: `${name}: ${condition}` });
  if (field.frequency !== undefined && !FREQUENCIES.has(field.frequency as FieldFrequency)) {
    out.push({ path: `${path}.frequency`, message: `${name} has an unknown "how often" value (${String(field.frequency)}).` });
  }
  if (field.frequency === "ROTATIONAL") {
    const cadence = field.rotationEveryNCleans;
    if (cadence !== undefined && !(typeof cadence === "number" && Number.isInteger(cadence) && cadence >= 1 && cadence <= 52)) {
      out.push({ path: `${path}.rotationEveryNCleans`, message: `${name} repeats on an invalid number of cleans.` });
    }
  }
  for (const finding of structuredFieldFindings(field)) {
    if (finding.incomplete && options.allowIncomplete) continue;
    out.push({ path, message: `${name} ${finding.message}` });
  }
  if (repeated && typeof field.id === "string" && REPEAT_SUFFIX.test(field.id)) {
    out.push({ path, message: `${name} sits in a per-room section, so its key cannot already end with a room number.` });
  }
}

/** Strict check run before a draft is saved or published. */
export function validateFormSchemaForSave(schema: unknown, options: SchemaSaveOptions = {}): SchemaSaveResult {
  const issues: SchemaSaveIssue[] = [];
  const parsed = formTemplateSchemaZ.safeParse(schema);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, MAX_SAVE_ISSUES)) {
      issues.push({ path: issue.path.join("."), message: issue.message });
    }
    return { ok: false, issues };
  }
  const sections = (schema as { sections: unknown[] }).sections;
  sections.forEach((section, sIdx) => {
    if (!isNode(section)) return;
    const sectionPath = `sections.${sIdx}`;
    const condition = conditionIssue(section.conditional);
    if (condition) issues.push({ path: `${sectionPath}.conditional`, message: `Section "${String(section.title ?? section.id)}": ${condition}` });
    if (section.repeatBy !== undefined && !REPEAT_BY.has(section.repeatBy as SectionRepeatBy)) {
      issues.push({ path: `${sectionPath}.repeatBy`, message: `Section "${String(section.title ?? section.id)}" repeats per an unknown room type.` });
    }
    const repeated = section.repeatBy !== undefined;
    const fields = Array.isArray(section.fields) ? section.fields : [];
    fields.forEach((field, fIdx) => {
      if (!isNode(field)) return;
      const fieldPath = `${sectionPath}.fields.${fIdx}`;
      fieldIssues(field, fieldPath, repeated, issues, options);
      const children = Array.isArray(field.children) ? field.children : [];
      children.forEach((child, cIdx) => {
        if (isNode(child)) fieldIssues(child, `${fieldPath}.children.${cIdx}`, repeated, issues, options);
      });
    });
  });
  for (const duplicate of duplicateStockCountItems(schema)) {
    issues.push({ path: "sections", message: `${duplicate.labels.map((label) => `"${label}"`).join(" and ")} count the same stock item; keep one.` });
  }
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues: issues.slice(0, MAX_SAVE_ISSUES) };
}
