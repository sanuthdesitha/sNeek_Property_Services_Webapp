/**
 * Form-template linting — governance for the builder (Phase 2.4).
 *
 * Catches the schema mistakes that silently break the cleaner flow:
 *  - duplicate section / field ids (BLOCKING — answers and uploads are keyed by
 *    field id, so a duplicate makes two fields share one answer and makes the
 *    submit gate un-satisfiable)
 *  - conditionals pointing at a field id that doesn't exist (the dependent field
 *    can never become visible)
 *  - required upload fields with `minPhotos: 0` (reads as "required" but the
 *    validator accepts zero files)
 *  - empty sections (render as dead headers)
 *  - legacy shapes (`label` instead of `title`, `upload`/`textarea` field types,
 *    `{ fieldId, equals }` conditionals) that normalizeFormSchema rewrites at
 *    read time — harmless but worth surfacing so the stored schema is canonical
 *
 * Dependency-free (no `@/lib/db`) so the client builder can import it.
 */

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  /** Stable rule id, e.g. "duplicate-field-id". */
  rule: string;
  severity: LintSeverity;
  message: string;
  /** Section id the issue belongs to, when known. */
  sectionId?: string;
  /** Field id the issue belongs to, when known. */
  fieldId?: string;
}

type AnyRec = Record<string, any>;

const UPLOAD_TYPES = new Set(["photo", "video", "file", "upload"]);
const LEGACY_FIELD_TYPES: Record<string, string> = {
  upload: "photo",
  textarea: "longtext",
};

function isRec(value: unknown): value is AnyRec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Every field in a schema, flattened one level (children included). */
function eachField(
  sections: AnyRec[],
  visit: (field: AnyRec, section: AnyRec, isChild: boolean) => void
) {
  for (const section of sections) {
    const fields = Array.isArray(section?.fields) ? section.fields : [];
    for (const field of fields) {
      if (!isRec(field)) continue;
      visit(field, section, false);
      const children = Array.isArray(field.children) ? field.children : [];
      for (const child of children) {
        if (isRec(child)) visit(child, section, true);
      }
    }
  }
}

/**
 * Lint a (possibly legacy) form-template schema. Never throws — a malformed
 * schema yields issues rather than an exception, because the builder calls this
 * on every keystroke.
 */
export function lintTemplateSchema(schema: unknown): LintIssue[] {
  const issues: LintIssue[] = [];
  const root = isRec(schema) ? schema : {};
  const sections: AnyRec[] = Array.isArray(root.sections) ? root.sections.filter(isRec) : [];

  if (!Array.isArray(root.sections)) {
    issues.push({
      rule: "missing-sections",
      severity: "error",
      message: "Schema has no `sections` array.",
    });
    return issues;
  }

  // ── ids: duplicates are blocking ──────────────────────────────────────────
  const seenSectionIds = new Set<string>();
  for (const section of sections) {
    const id = typeof section.id === "string" ? section.id : "";
    if (!id) {
      issues.push({
        rule: "missing-section-id",
        severity: "error",
        message: `Section "${section.title ?? section.label ?? "(untitled)"}" has no id.`,
      });
      continue;
    }
    if (seenSectionIds.has(id)) {
      issues.push({
        rule: "duplicate-section-id",
        severity: "error",
        sectionId: id,
        message: `Duplicate section id "${id}" — section ids must be unique.`,
      });
    }
    seenSectionIds.add(id);
  }

  const seenFieldIds = new Set<string>();
  const knownFieldIds = new Set<string>();
  eachField(sections, (field) => {
    const id = typeof field.id === "string" ? field.id : "";
    if (id) knownFieldIds.add(id);
  });

  eachField(sections, (field, section, isChild) => {
    const sectionId = typeof section.id === "string" ? section.id : undefined;
    const id = typeof field.id === "string" ? field.id : "";
    const label = typeof field.label === "string" && field.label ? field.label : id || "(unlabelled)";

    if (!id) {
      issues.push({
        rule: "missing-field-id",
        severity: "error",
        sectionId,
        message: `Field "${label}" has no id.`,
      });
    } else {
      if (seenFieldIds.has(id)) {
        issues.push({
          rule: "duplicate-field-id",
          severity: "error",
          sectionId,
          fieldId: id,
          message: `Duplicate field id "${id}" — answers and uploads are keyed by field id.`,
        });
      }
      seenFieldIds.add(id);
    }

    // ── conditionals ────────────────────────────────────────────────────────
    const cond = field.conditional;
    if (isRec(cond) && typeof cond.fieldId === "string" && cond.fieldId) {
      if (!knownFieldIds.has(cond.fieldId)) {
        issues.push({
          rule: "conditional-missing-field",
          severity: "error",
          sectionId,
          fieldId: id || undefined,
          message: `"${label}" is conditional on field "${cond.fieldId}", which does not exist in this template.`,
        });
      }
      if (cond.operator === undefined && "equals" in cond) {
        issues.push({
          rule: "legacy-conditional",
          severity: "warning",
          sectionId,
          fieldId: id || undefined,
          message: `"${label}" uses the legacy { fieldId, equals } conditional shape — save to canonicalise it.`,
        });
      }
    }

    // ── uploads ─────────────────────────────────────────────────────────────
    const type = typeof field.type === "string" ? field.type : "";
    if (UPLOAD_TYPES.has(type) && field.required === true && field.minPhotos === 0) {
      issues.push({
        rule: "required-upload-zero-min",
        severity: "error",
        sectionId,
        fieldId: id || undefined,
        message: `"${label}" is a required upload with minPhotos 0 — it can be satisfied with no files.`,
      });
    }

    // ── legacy field types ──────────────────────────────────────────────────
    if (type && LEGACY_FIELD_TYPES[type]) {
      issues.push({
        rule: "legacy-field-type",
        severity: "warning",
        sectionId,
        fieldId: id || undefined,
        message: `"${label}" uses the legacy type "${type}" (renders as "${LEGACY_FIELD_TYPES[type]}").`,
      });
    }

    // Sub-fields may not have sub-fields of their own.
    if (isChild && Array.isArray(field.children) && field.children.length > 0) {
      issues.push({
        rule: "nested-children",
        severity: "error",
        sectionId,
        fieldId: id || undefined,
        message: `"${label}" is a sub-field with its own sub-fields — only one level is supported.`,
      });
    }
  });

  // ── sections ──────────────────────────────────────────────────────────────
  for (const section of sections) {
    const sectionId = typeof section.id === "string" ? section.id : undefined;
    const fields = Array.isArray(section.fields) ? section.fields : [];
    if (fields.length === 0) {
      issues.push({
        rule: "empty-section",
        severity: "warning",
        sectionId,
        message: `Section "${section.title ?? section.label ?? sectionId ?? "(untitled)"}" has no fields.`,
      });
    }
    if (typeof section.title !== "string" && typeof section.label === "string") {
      issues.push({
        rule: "legacy-section-heading",
        severity: "warning",
        sectionId,
        message: `Section "${section.label}" uses the legacy \`label\` key instead of \`title\`.`,
      });
    }

    const cond = section.conditional;
    if (isRec(cond) && typeof cond.fieldId === "string" && cond.fieldId && !knownFieldIds.has(cond.fieldId)) {
      issues.push({
        rule: "conditional-missing-field",
        severity: "error",
        sectionId,
        message: `Section "${section.title ?? sectionId}" is conditional on field "${cond.fieldId}", which does not exist in this template.`,
      });
    }
  }

  return issues;
}

/** True when any issue would block a safe publish. */
export function hasBlockingIssues(issues: LintIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
