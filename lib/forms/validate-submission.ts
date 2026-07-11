// Client-side submission validation for the v2 native form renderer.
//
// Surfaces the SAME required-field rules the submit endpoint enforces
// (collectRequiredAnswerFields / collectRequiredUploadFields in ./visibility)
// so the form can block + highlight before the round-trip, PLUS the two extra
// per-field rules the renderer knows about but the coarse collectors don't:
//   - photo fields with `minPhotos` (even when not `required`)
//   - yes/no fields with `detailsWhenNo` needing a details note when "No"
//
// The server stays authoritative — this only mirrors it for inline UX.
import {
  collectRequiredAnswerFields,
  collectRequiredUploadFields,
  flattenFieldsOneLevel,
  isFlattenedFieldVisible,
  isTemplateNodeVisible,
  fieldDetailsKey,
} from "./visibility";

export interface FormFieldError {
  fieldId: string;
  sectionId?: string;
  sectionLabel?: string;
  label: string;
  message: string;
}

type AnswerMap = Record<string, unknown>;
type UploadCounts = Record<string, number>;

/** True when an answer value is effectively empty. */
function isEmpty(value: unknown) {
  return (
    value == null ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Collect every blocking validation error for the current answers/uploads.
 * `uploadCounts` maps fieldId → number of committed media for that field.
 */
export function collectFormErrors(
  templateSchema: any,
  answers: AnswerMap,
  uploadCounts: UploadCounts,
  property: Record<string, unknown>,
  laundryReady?: boolean
): FormFieldError[] {
  const errors: FormFieldError[] = [];
  const seen = new Set<string>();

  const push = (err: FormFieldError) => {
    if (seen.has(err.fieldId)) return;
    seen.add(err.fieldId);
    errors.push(err);
  };

  // 1) Required answerable fields (text/number/select/radio/yesno/rating/…).
  for (const field of collectRequiredAnswerFields(templateSchema, answers, property, { laundryReady })) {
    push({
      fieldId: field.id,
      sectionId: field.sectionId,
      sectionLabel: field.sectionLabel,
      label: field.label,
      message: "This field is required.",
    });
  }

  // 2) Required upload fields with nothing committed.
  for (const field of collectRequiredUploadFields(templateSchema, answers, property, laundryReady)) {
    if ((uploadCounts[field.id] ?? 0) > 0) continue;
    push({
      fieldId: field.id,
      sectionId: field.sectionId,
      sectionLabel: field.sectionLabel,
      label: field.label,
      message: "Add at least one photo/file.",
    });
  }

  // 3) Extra renderer-only rules: minPhotos shortfalls + yes/no details.
  const sections = Array.isArray(templateSchema?.sections) ? templateSchema.sections : [];
  for (const section of sections) {
    if (!isTemplateNodeVisible(section, answers, property, laundryReady)) continue;
    const sectionId =
      typeof section?.id === "string" && section.id.trim() ? section.id.trim() : undefined;
    const sectionLabel =
      (typeof section?.title === "string" && section.title.trim()) ||
      (typeof section?.label === "string" && section.label.trim()) ||
      sectionId;

    for (const field of flattenFieldsOneLevel(section?.fields)) {
      if (!field?.id) continue;
      if (!isFlattenedFieldVisible(field, answers, property, laundryReady)) continue;
      const type = typeof field.type === "string" ? field.type.toLowerCase() : "";
      const label =
        typeof field.label === "string" && field.label.trim() ? field.label.trim() : String(field.id);

      // photo minimum (independent of `required`)
      if (type === "photo") {
        const need = Math.max(0, Number(field.minPhotos ?? 0));
        const have = uploadCounts[String(field.id)] ?? 0;
        if (need > 0 && have < need) {
          push({
            fieldId: String(field.id),
            sectionId,
            sectionLabel,
            label,
            message: `Add at least ${need} photo${need === 1 ? "" : "s"} — ${have} added.`,
          });
        }
      }

      // yes/no "details when No" note becomes required.
      if (type === "yesno" && field.detailsWhenNo) {
        const answer = answers[String(field.id)];
        if (answer === "no" || answer === false) {
          const detail = answers[fieldDetailsKey(String(field.id))];
          if (isEmpty(detail)) {
            push({
              fieldId: fieldDetailsKey(String(field.id)),
              sectionId,
              sectionLabel,
              label: `${label} — details`,
              message: "Add details for the “No” answer.",
            });
          }
        }
      }
    }
  }

  return errors;
}
