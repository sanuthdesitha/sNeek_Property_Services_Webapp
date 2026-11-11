/**
 * "Checks" for the forms library: run a stored template schema through the
 * validators the builder and save route already use and summarise the result.
 *
 *  - formTemplateSchemaZ (the structure every renderer relies on; the save
 *    route refuses a schema that fails it)
 *  - lintTemplateSchema (duplicate ids, dangling conditions, legacy shapes …)
 *  - the field-type registry (a question whose type no renderer knows, a
 *    choice question without options, an inverted numeric range)
 *
 * PURE: no database. A malformed schema yields issues, never an exception.
 */
import { formTemplateSchemaZ } from "./template-schema";
import { lintTemplateSchema } from "./lint-template";
import { getFieldTypeDef } from "./field-types";
import { duplicateStockCountItems, structuredFieldIssues } from "./structured-schema-checks";

export type TemplateCheckSeverity = "error" | "warning";

export type TemplateCheckIssue = {
  rule: string;
  severity: TemplateCheckSeverity;
  message: string;
  sectionId?: string;
  fieldId?: string;
};

export type TemplateCheckStatus = "pass" | "warnings" | "errors";

export type TemplateCheckResult = {
  status: TemplateCheckStatus;
  errors: number;
  warnings: number;
  issues: TemplateCheckIssue[];
};

type SchemaNode = Record<string, unknown>;

/** Legacy types normalizeFormSchema rewrites at read time (lint warns on them). */
const LEGACY_TYPES = new Set(["upload", "textarea"]);
const MAX_STRUCTURE_ISSUES = 5;

function isNode(value: unknown): value is SchemaNode {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function labelOf(field: SchemaNode): string {
  return typeof field.label === "string" && field.label.trim() ? field.label.trim() : String(field.id ?? "question");
}

function structureIssues(schema: unknown): TemplateCheckIssue[] {
  const parsed = formTemplateSchemaZ.safeParse(schema);
  if (parsed.success) return [];
  return parsed.error.issues.slice(0, MAX_STRUCTURE_ISSUES).map((issue) => ({
    rule: "structure",
    severity: "error" as const,
    message: `Structure: ${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
  }));
}

function fieldTypeIssues(field: SchemaNode, sectionId: string | undefined): TemplateCheckIssue[] {
  const issues: TemplateCheckIssue[] = [];
  const fieldId = typeof field.id === "string" ? field.id : undefined;
  const type = typeof field.type === "string" ? field.type : "";
  if (LEGACY_TYPES.has(type)) return issues;
  const def = getFieldTypeDef(type);
  if (!def) {
    issues.push({
      rule: "unknown-field-type",
      severity: "error",
      message: `"${labelOf(field)}" has a question type no form can show (${type || "none"}).`,
      sectionId,
      fieldId,
    });
    return issues;
  }
  if (def.hasOptions) {
    const options = Array.isArray(field.options) ? field.options.filter((o) => typeof o === "string" && o.trim()) : [];
    if (options.length === 0) {
      issues.push({
        rule: "choice-without-options",
        severity: "warning",
        message: `"${labelOf(field)}" is a choice question with no options.`,
        sectionId,
        fieldId,
      });
    }
  }
  for (const message of structuredFieldIssues(field)) {
    issues.push({ rule: "question-setup", severity: "error", message: `"${labelOf(field)}" ${message}`, sectionId, fieldId });
  }
  if (def.hasRange && typeof field.min === "number" && typeof field.max === "number" && field.min > field.max) {
    issues.push({
      rule: "inverted-range",
      severity: "warning",
      message: `"${labelOf(field)}" has a minimum above its maximum.`,
      sectionId,
      fieldId,
    });
  }
  return issues;
}

function registryIssues(schema: unknown): TemplateCheckIssue[] {
  if (!isNode(schema) || !Array.isArray(schema.sections)) return [];
  const issues: TemplateCheckIssue[] = [];
  for (const section of schema.sections) {
    if (!isNode(section) || !Array.isArray(section.fields)) continue;
    const sectionId = typeof section.id === "string" ? section.id : undefined;
    for (const field of section.fields) {
      if (!isNode(field)) continue;
      issues.push(...fieldTypeIssues(field, sectionId));
      const children = Array.isArray(field.children) ? field.children : [];
      for (const child of children) {
        if (isNode(child)) issues.push(...fieldTypeIssues(child, sectionId));
      }
    }
  }
  for (const duplicate of duplicateStockCountItems(schema)) {
    issues.push({
      rule: "duplicate-stock-count",
      severity: "error",
      message: `${duplicate.labels.map((label) => `"${label}"`).join(" and ")} count the same stock item; keep one.`,
    });
  }
  return issues;
}

export function summariseIssues(issues: TemplateCheckIssue[]): TemplateCheckResult {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const status: TemplateCheckStatus = errors > 0 ? "errors" : warnings > 0 ? "warnings" : "pass";
  return { status, errors, warnings, issues };
}

/** Every validator over one stored schema. */
export function checkTemplateSchema(schema: unknown): TemplateCheckResult {
  const lint = lintTemplateSchema(schema).map<TemplateCheckIssue>((issue) => ({
    rule: issue.rule,
    severity: issue.severity,
    message: issue.message,
    sectionId: issue.sectionId,
    fieldId: issue.fieldId,
  }));
  return summariseIssues([...structureIssues(schema), ...lint, ...registryIssues(schema)]);
}

/**
 * The live schema is what cleaners receive; an unpublished draft is checked
 * too, its issues prefixed "Draft:", so a broken draft is visible before it is
 * published and a broken live form is not hidden by a fixed draft.
 */
export function checkTemplateWithDraft(liveSchema: unknown, draftSchema: unknown | null): TemplateCheckResult {
  const live = checkTemplateSchema(liveSchema).issues;
  const draft =
    draftSchema === null
      ? []
      : checkTemplateSchema(draftSchema).issues.map((issue) => ({ ...issue, message: `Draft: ${issue.message}` }));
  return summariseIssues([...live, ...draft]);
}

/** A required question the usage check found never answered (lib/forms/submission-stats.ts). */
export type NeverAnsweredQuestion = { id: string; label: string };

/**
 * The library's Checks for one form: the validator result plus the usage
 * check folded in as WARNINGS (rule "never-answered"), with the usage check's
 * own thresholds and exclusions (USAGE_CHECK_DAYS, USAGE_CHECK_MIN_SUBMISSIONS,
 * always-shown required questions only). `null` = the usage check did not run
 * for this form, so nothing is added and nothing is claimed.
 */
export function withUsageWarnings(result: TemplateCheckResult, neverAnswered: NeverAnsweredQuestion[] | null): TemplateCheckResult {
  if (!neverAnswered || neverAnswered.length === 0) return result;
  const usage = neverAnswered.map<TemplateCheckIssue>((question) => ({
    rule: "never-answered",
    severity: "warning",
    message: `"${question.label}" was never answered in recent submissions.`,
    fieldId: question.id,
  }));
  return summariseIssues([...result.issues, ...usage]);
}
