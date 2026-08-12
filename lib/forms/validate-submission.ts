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
  laundryReady?: boolean,
  /**
   * Mirrors `settings.accountability.requiredChecklistTicksBlockSubmit`, which
   * the cleaner receives in the GET /api/jobs/[id]/form payload. Defaults to
   * false so a caller that doesn't pass it keeps the historic behaviour, and so
   * this client mirror can never be stricter than the server by accident.
   */
  requiredChecklistTicksBlockSubmit: boolean = false,
  /**
   * "No photo taken" exemption (admin-granted per cleaner). When the cleaner
   * holds the exemption and has recorded a reason for a field, that field's
   * upload requirement and minimum-file rule are waived here — mirroring the
   * server, which stays authoritative and re-checks the grant.
   */
  noPhoto?: {
    canUseNoPhoto: boolean;
    reasons: Record<string, { reasonCode: string } | undefined>;
  }
): FormFieldError[] {
  const errors: FormFieldError[] = [];
  const seen = new Set<string>();
  const hasNoPhotoWaiver = (fieldId: string) =>
    noPhoto?.canUseNoPhoto === true && Boolean(noPhoto.reasons?.[fieldId]);

  const push = (err: FormFieldError) => {
    if (seen.has(err.fieldId)) return;
    seen.add(err.fieldId);
    errors.push(err);
  };

  // 1) Required answerable fields (text/number/select/radio/yesno/rating/…).
  for (const field of collectRequiredAnswerFields(templateSchema, answers, property, {
    laundryReady,
    requiredChecklistTicksBlockSubmit,
  })) {
    push({
      fieldId: field.id,
      sectionId: field.sectionId,
      sectionLabel: field.sectionLabel,
      label: field.label,
      // A required checkbox is a confirmation, not a blank — say what to do.
      message:
        field.type === "checkbox" ? "Tick this box to confirm." : "This field is required.",
    });
  }

  // 2) Required upload fields with nothing committed.
  for (const field of collectRequiredUploadFields(templateSchema, answers, property, laundryReady)) {
    if ((uploadCounts[field.id] ?? 0) > 0) continue;
    if (hasNoPhotoWaiver(field.id)) continue;
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

      // File minimum (independent of `required`). Applies to photo AND file
      // fields — the builder exposes "Min files" for both, and only enforcing it
      // for photos meant a document field's minimum was silently ignored.
      if (type === "photo" || type === "file") {
        const need = Math.max(0, Number(field.minPhotos ?? 0));
        const have = uploadCounts[String(field.id)] ?? 0;
        if (need > 0 && have < need && !hasNoPhotoWaiver(String(field.id))) {
          const noun = type === "file" ? "file" : "photo";
          push({
            fieldId: String(field.id),
            sectionId,
            sectionLabel,
            label,
            message: `Add at least ${need} ${noun}${need === 1 ? "" : "s"} — ${have} added.`,
          });
        }
      }

      // Numeric range. The builder lets an admin set min/max on number-ish
      // fields, and the input carries them as attributes, but a typed value
      // outside the range still submitted silently — enforce it in the same
      // place every other rule lives so the cleaner sees why.
      if (type === "number" || type === "currency" || type === "temperature" || type === "counter") {
        const answer = answers[String(field.id)];
        const num = typeof answer === "number" ? answer : Number(answer);
        if (!isEmpty(answer) && Number.isFinite(num)) {
          const min = Number(field.min);
          const max = Number(field.max);
          const below = Number.isFinite(min) && num < min;
          const above = Number.isFinite(max) && num > max;
          if (below || above) {
            push({
              fieldId: String(field.id),
              sectionId,
              sectionLabel,
              label,
              message: Number.isFinite(min) && Number.isFinite(max)
                ? `Enter a value between ${min} and ${max}.`
                : below
                  ? `Enter ${min} or more.`
                  : `Enter ${max} or less.`,
            });
          }
        }
      }

      // Email shape — permissive on purpose (something@something.something);
      // only a clearly malformed address blocks, and the message says so.
      if (type === "email") {
        const answer = answers[String(field.id)];
        if (typeof answer === "string" && answer.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer.trim())) {
          push({
            fieldId: String(field.id),
            sectionId,
            sectionLabel,
            label,
            message: "Enter a valid email address.",
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
