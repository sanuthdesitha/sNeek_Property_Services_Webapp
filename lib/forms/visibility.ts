import { isUploadFieldType } from "./field-types";
import { isSelfInspectionSection } from "./self-inspection";

type TemplateNode = {
  id?: unknown;
  label?: unknown;
  type?: unknown;
  required?: unknown;
  conditional?: unknown;
  fields?: unknown;
  children?: unknown;
};

/** Key under which a yes/no field's "details when No" note is stored. */
export function fieldDetailsKey(fieldId: string) {
  return `${fieldId}_details`;
}

/**
 * Expands each field's `children` (sub-fields, one level deep) inline after
 * the parent. Child entries are annotated with `_isChild`/`_parentId` and a
 * `_parent` reference so callers can apply parent-aware visibility and
 * indentation. Safe on legacy fields without children.
 */
export function flattenFieldsOneLevel(fields: unknown): any[] {
  const list = Array.isArray(fields) ? fields : [];
  const out: any[] = [];
  for (const field of list) {
    if (!field || typeof field !== "object") continue;
    out.push(field);
    const children = Array.isArray((field as any).children) ? (field as any).children : [];
    for (const child of children) {
      if (!child || typeof child !== "object" || !(child as any).id) continue;
      out.push({ ...child, _isChild: true, _parentId: (field as any).id, _parent: field });
    }
  }
  return out;
}

/** Visibility for a flattened field entry: its own condition AND its parent's. */
export function isFlattenedFieldVisible(
  field: any,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
  laundryReady?: boolean
) {
  if (!isTemplateNodeVisible(field, answers, property, laundryReady)) return false;
  if (field?._parent && !isTemplateNodeVisible(field._parent, answers, property, laundryReady)) {
    return false;
  }
  return true;
}

/** Display heading for a section: canonical `title`, legacy `label`, then id. */
function sectionHeading(section: any): string | undefined {
  const title = typeof section?.title === "string" ? section.title.trim() : "";
  if (title) return title;
  const label = typeof section?.label === "string" ? section.label.trim() : "";
  if (label) return label;
  const id = typeof section?.id === "string" ? section.id.trim() : "";
  return id || undefined;
}

export type RequiredUploadFieldMeta = {
  id: string;
  label: string;
  sectionId?: string;
  sectionLabel?: string;
};

export type RequiredAnswerFieldMeta = RequiredUploadFieldMeta & {
  type?: string;
};

/**
 * Boolean reading of a yes/no-ish value. Yes/No + checkbox answers are stored
 * as booleans, but "yes"/"no" strings exist in older submissions (and in
 * hand-authored conditions), so both must compare equal to a boolean — without
 * this, `{ operator: "equals", value: true }` on a yes/no field never fires.
 * "na" is deliberately NOT boolean: it equals neither Yes nor No.
 */
function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "yes") return true;
    if (s === "false" || s === "no") return false;
  }
  return null;
}

export function templateValuesEqual(left: unknown, right: unknown) {
  if (typeof left === "boolean") return left === asBoolean(right);
  if (typeof left === "number") return left === Number(right);
  if (typeof right === "boolean") return asBoolean(left) === right;
  if (typeof right === "number") return Number(left) === right;
  return String(left ?? "") === String(right ?? "");
}

export function isBalconyLikeTemplateNode(node: TemplateNode | null | undefined) {
  const text = `${String(node?.id ?? "")} ${String(node?.label ?? "")}`.toLowerCase();
  return text.includes("balcony");
}

function isAnswered(value: unknown) {
  return !(
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function isTemplateConditionalMet(
  conditional: any,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
  laundryReady?: boolean
) {
  if (!conditional || typeof conditional !== "object") return true;

  // Expected comparison value: prefer the operator-form `value`, fall back to
  // the legacy `equals` shape used by older templates.
  const expected = "value" in conditional ? conditional.value : conditional.equals;
  const operator: string = typeof conditional.operator === "string" ? conditional.operator : "equals";

  if ("propertyField" in conditional) {
    return templateValuesEqual(property[conditional.propertyField], expected);
  }

  if ("fieldId" in conditional) {
    let answerValue = answers[conditional.fieldId];
    if (answerValue === undefined && /laundry/i.test(String(conditional.fieldId))) {
      answerValue = laundryReady;
    }

    // Multiselect/checkbox answers are arrays (e.g. two exceptions ticked).
    // For scalar comparisons treat an array answer as MEMBERSHIP: the rule
    // fires when any selected value matches. Without this, String([a,b]) =>
    // "a,b" never equals a scalar, so a field revealed by one selection would
    // vanish the moment a second option is picked.
    const answerList = Array.isArray(answerValue) ? (answerValue as unknown[]) : null;
    const matchesExpected = (target: unknown) =>
      answerList
        ? answerList.some((v) => templateValuesEqual(v, target))
        : templateValuesEqual(answerValue, target);

    // "contains": membership for multi-value answers (multiselect), substring
    // for free text. Lets a rule read naturally for both without the author
    // having to know how the answer is stored.
    const containsExpected = (target: unknown) => {
      if (answerList) return answerList.some((v) => templateValuesEqual(v, target));
      if (answerValue === undefined || answerValue === null) return false;
      return String(answerValue).toLowerCase().includes(String(target ?? "").toLowerCase());
    };

    // gt/lt are numeric-only: a non-numeric answer (empty, text, array) must not
    // satisfy either, instead of silently comparing NaN.
    const numeric = (value: unknown) => {
      if (value === "" || value === null || value === undefined || Array.isArray(value)) return NaN;
      return Number(value);
    };

    switch (operator) {
      case "answered":
        return isAnswered(answerValue);
      case "notAnswered":
        return !isAnswered(answerValue);
      case "notEquals":
        return !matchesExpected(expected);
      case "contains":
        return containsExpected(expected);
      case "notContains":
        return !containsExpected(expected);
      case "oneOf": {
        const list = Array.isArray(expected) ? expected : [expected];
        return list.some((item) => matchesExpected(item));
      }
      case "gt": {
        const a = numeric(answerValue);
        const b = numeric(expected);
        return Number.isFinite(a) && Number.isFinite(b) && a > b;
      }
      case "lt": {
        const a = numeric(answerValue);
        const b = numeric(expected);
        return Number.isFinite(a) && Number.isFinite(b) && a < b;
      }
      case "equals":
      default:
        return matchesExpected(expected);
    }
  }

  return true;
}

export function isTemplateNodeVisible(
  node: TemplateNode | null | undefined,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
  laundryReady?: boolean
) {
  if (property?.hasBalcony !== true && isBalconyLikeTemplateNode(node)) {
    return false;
  }
  return isTemplateConditionalMet(node?.conditional, answers, property, laundryReady);
}

export function collectRequiredUploadFields(
  templateSchema: any,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
  laundryReady?: boolean
): RequiredUploadFieldMeta[] {
  const sections = Array.isArray(templateSchema?.sections) ? templateSchema.sections : [];
  const uploads: RequiredUploadFieldMeta[] = [];

  for (const section of sections) {
    if (!isTemplateNodeVisible(section, answers, property, laundryReady)) continue;

    const fields = flattenFieldsOneLevel(section?.fields);
    for (const field of fields) {
      if (!isUploadFieldType(field?.type) || !field?.required || !field?.id) continue;
      if (!isFlattenedFieldVisible(field, answers, property, laundryReady)) continue;

      uploads.push({
        id: String(field.id),
        label:
          typeof field.label === "string" && field.label.trim()
            ? field.label.trim()
            : String(field.id),
        sectionId:
          typeof section?.id === "string" && section.id.trim() ? section.id.trim() : undefined,
        // The canonical heading key is `title` (normalize-schema maps legacy
        // `label` → `title`), so read title first or every error/summary line
        // for a modern template falls back to the raw section id.
        sectionLabel: sectionHeading(section),
      });
    }
  }

  return uploads;
}

/**
 * THE required-answer rule, in one pure place so the cleaner's client gate and
 * the submit route can never disagree about what counts as answered.
 *
 * Generic rule: null/undefined, a blank string, or an empty array is missing.
 * An explicit `false` is a genuine answer for every OTHER type (a yes/no
 * answered "No" stores boolean `false` — that must stay valid).
 *
 * Checkbox exception — OPT-IN, off by default: a required checkbox is a
 * confirmation, so it is only answered when ticked (`true`). An unticked box
 * arrives as `false`, which the generic rule waves through. Making that block
 * is a big change (generated checklist items are `checkbox`+`required`, so the
 * whole checklist becomes mandatory), so it only applies when the caller passes
 * `requiredChecklistTicksBlockSubmit: true` — mirroring the admin setting of
 * the same name. This function stays PURE: it never reads settings itself, so
 * the client gate and the submit route are handed the identical flag.
 *
 * Self-inspection exception to the exception: checkboxes inside the composed
 * final self-inspection section fall back to the generic rule, because the
 * submit route owns them with its own gate (collectUntickedSelfInspection),
 * which `settings.accountability.selfInspectionBlocksSubmit` can switch off.
 * Applying the checkbox rule there would silently defeat that opt-out.
 */
export function isRequiredAnswerMissing(
  fieldType: string,
  value: unknown,
  options?: { inSelfInspectionSection?: boolean; requiredChecklistTicksBlockSubmit?: boolean }
): boolean {
  const ticksBlock = options?.requiredChecklistTicksBlockSubmit ?? false;
  if (fieldType === "checkbox" && ticksBlock && !options?.inSelfInspectionSection) {
    return value !== true;
  }
  return (
    value == null ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function collectRequiredAnswerFields(
  templateSchema: any,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
  options?: {
    laundryReady?: boolean;
    fieldTypes?: string[];
    /**
     * Mirrors `settings.accountability.requiredChecklistTicksBlockSubmit`.
     * Defaults to false so any caller that doesn't pass it keeps the historic
     * behaviour (an unticked required checkbox does NOT block).
     */
    requiredChecklistTicksBlockSubmit?: boolean;
  }
): RequiredAnswerFieldMeta[] {
  const requiredChecklistTicksBlockSubmit = options?.requiredChecklistTicksBlockSubmit ?? false;
  const sections = Array.isArray(templateSchema?.sections) ? templateSchema.sections : [];
  const required: RequiredAnswerFieldMeta[] = [];
  const allowedTypes = options?.fieldTypes?.length
    ? new Set(options.fieldTypes.map((value) => value.trim().toLowerCase()))
    : null;

  for (const section of sections) {
    if (!isTemplateNodeVisible(section, answers, property, options?.laundryReady)) continue;
    const inSelfInspectionSection = isSelfInspectionSection(section);

    const fields = flattenFieldsOneLevel(section?.fields);
    for (const field of fields) {
      if (!field?.required || !field?.id) continue;
      if (!isFlattenedFieldVisible(field, answers, property, options?.laundryReady)) continue;
      const fieldType = typeof field.type === "string" ? field.type.trim().toLowerCase() : "";
      // Upload fields (photo/video/file) are never stored in `answers` — they're
      // validated separately by collectRequiredUploadFields — so skip them here,
      // otherwise a no-filter call would wrongly report every required upload.
      if (isUploadFieldType(fieldType)) continue;
      if (allowedTypes && !allowedTypes.has(fieldType)) continue;

      const value = answers[String(field.id)];
      if (
        !isRequiredAnswerMissing(fieldType, value, {
          inSelfInspectionSection,
          requiredChecklistTicksBlockSubmit,
        })
      ) {
        continue;
      }

      required.push({
        id: String(field.id),
        type: fieldType || undefined,
        label:
          typeof field.label === "string" && field.label.trim()
            ? field.label.trim()
            : String(field.id),
        sectionId:
          typeof section?.id === "string" && section.id.trim() ? section.id.trim() : undefined,
        // The canonical heading key is `title` (normalize-schema maps legacy
        // `label` → `title`), so read title first or every error/summary line
        // for a modern template falls back to the raw section id.
        sectionLabel: sectionHeading(section),
      });
    }
  }

  return required;
}
