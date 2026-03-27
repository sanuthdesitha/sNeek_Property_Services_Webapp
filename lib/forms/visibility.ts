type TemplateNode = {
  id?: unknown;
  label?: unknown;
  type?: unknown;
  required?: unknown;
  conditional?: unknown;
  fields?: unknown;
};

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

export function isTemplateConditionalMet(
  conditional: any,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
  laundryReady?: boolean
) {
  if (!conditional || typeof conditional !== "object") return true;

  if ("propertyField" in conditional) {
    return templateValuesEqual(property[conditional.propertyField], conditional.value);
  }

  if ("fieldId" in conditional) {
    const answerValue = answers[conditional.fieldId];
    if (answerValue === undefined && /laundry/i.test(String(conditional.fieldId))) {
      return templateValuesEqual(laundryReady, conditional.value);
    }
    return templateValuesEqual(answerValue, conditional.value);
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

    const fields = Array.isArray(section?.fields) ? section.fields : [];
    for (const field of fields) {
      if (field?.type !== "upload" || !field?.required || !field?.id) continue;
      if (!isTemplateNodeVisible(field, answers, property, laundryReady)) continue;

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

    const fields = Array.isArray(section?.fields) ? section.fields : [];
    for (const field of fields) {
      if (!field?.required || !field?.id) continue;
      if (!isTemplateNodeVisible(field, answers, property, options?.laundryReady)) continue;
      const fieldType = typeof field.type === "string" ? field.type.trim().toLowerCase() : "";
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
