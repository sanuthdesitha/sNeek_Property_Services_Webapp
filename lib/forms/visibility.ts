import { isUploadFieldType } from "./field-types";

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

export type RequiredUploadFieldMeta = {
  id: string;
  label: string;
  sectionId?: string;
  sectionLabel?: string;
};

export type RequiredAnswerFieldMeta = RequiredUploadFieldMeta & {
  type?: string;
};

export function templateValuesEqual(left: unknown, right: unknown) {
  if (typeof left === "boolean") return left === (right === true || right === "true");
  if (typeof left === "number") return left === Number(right);
  if (typeof right === "boolean") return (left === true || left === "true") === right;
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

    switch (operator) {
      case "answered":
        return isAnswered(answerValue);
      case "notAnswered":
        return !isAnswered(answerValue);
      case "notEquals":
        return !matchesExpected(expected);
      case "oneOf": {
        const list = Array.isArray(expected) ? expected : [expected];
        return list.some((item) => matchesExpected(item));
      }
      case "gt":
        return Number(answerValue) > Number(expected);
      case "lt":
        return Number(answerValue) < Number(expected);
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
        sectionLabel:
          typeof section?.label === "string" && section.label.trim()
            ? section.label.trim()
            : typeof section?.id === "string" && section.id.trim()
              ? section.id.trim()
              : undefined,
      });
    }
  }

  return uploads;
}

export function collectRequiredAnswerFields(
  templateSchema: any,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
  options?: {
    laundryReady?: boolean;
    fieldTypes?: string[];
  }
): RequiredAnswerFieldMeta[] {
  const sections = Array.isArray(templateSchema?.sections) ? templateSchema.sections : [];
  const required: RequiredAnswerFieldMeta[] = [];
  const allowedTypes = options?.fieldTypes?.length
    ? new Set(options.fieldTypes.map((value) => value.trim().toLowerCase()))
    : null;

  for (const section of sections) {
    if (!isTemplateNodeVisible(section, answers, property, options?.laundryReady)) continue;

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
      const missing =
        value == null ||
        (typeof value === "string" && value.trim().length === 0) ||
        (Array.isArray(value) && value.length === 0);
      if (!missing) continue;

      required.push({
        id: String(field.id),
        type: fieldType || undefined,
        label:
          typeof field.label === "string" && field.label.trim()
            ? field.label.trim()
            : String(field.id),
        sectionId:
          typeof section?.id === "string" && section.id.trim() ? section.id.trim() : undefined,
        sectionLabel:
          typeof section?.label === "string" && section.label.trim()
            ? section.label.trim()
            : typeof section?.id === "string" && section.id.trim()
              ? section.id.trim()
              : undefined,
      });
    }
  }

  return required;
}
