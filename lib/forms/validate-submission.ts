import { isDeviceStatusField, incompleteDeviceExceptions } from "./device-status";
// Shared submission validation for the native renderer and submit endpoint.
//
// Surfaces the SAME required-field rules the submit endpoint enforces
// (collectRequiredAnswerFields / collectRequiredUploadFields in ./visibility)
// so the form can block + highlight before the round-trip, PLUS the two extra
// per-field rules the renderer knows about but the coarse collectors don't:
//   - photo fields with `minPhotos` (even when not `required`)
//   - yes/no fields with `detailsWhenNo` needing a details note when "No"
//
// The server stays authoritative — this only mirrors it for inline UX.
import { isUploadFieldType } from "./field-types";
import { structuredAnswerError } from "./structured-answers";
import {
  collectRequiredAnswerFields,
  collectRequiredUploadFields,
  flattenFieldsOneLevel,
  isFlattenedFieldVisible,
  isTemplateNodeVisible,
  fieldDetailsKey,
} from "./visibility";

/**
 * Which rule produced an error. The submit route already rejected the
 * "core" rules before this module was run on the server; the others are
 * "extended" rules (see EXTENDED_FORM_RULES) that the server records as
 * warnings until ENFORCE_EXTENDED_FORM_VALIDATION is switched on.
 */
export type FormErrorRule =
  | "device"
  | "required"
  | "upload"
  | "minimum"
  | "range"
  | "email"
  | "details"
  | "number-format"
  | "phone"
  | "date"
  | "option"
  | "scale-range"
  | "max-files"
  // Structured types (lib/forms/structured-answers.ts): enforced from the
  // first release, never an extended warning.
  | "table"
  | "stock-count";

export interface FormFieldError {
  fieldId: string;
  sectionId?: string;
  sectionLabel?: string;
  label: string;
  message: string;
  rule?: FormErrorRule;
}

/** Rules the cleaner submit route did not enforce before this release. */
export const EXTENDED_FORM_RULES: ReadonlySet<FormErrorRule> = new Set<FormErrorRule>([
  "range",
  "email",
  "details",
  "number-format",
  "phone",
  "date",
  "option",
  "scale-range",
  "max-files",
]);

/**
 * Roll-out switch for server-side enforcement of EXTENDED_FORM_RULES.
 *
 * false (this release): the submit route records violations as warnings on
 * the submission (`data.__validationWarnings`) and accepts it, so a draft
 * started before these rules existed is never rejected by a rule it could not
 * have known; the cleaner's phone keeps showing only the rules it showed
 * before. true (a later release): the submit route rejects them like any
 * other rule and the phone shows them inline.
 *
 * Deliberately a constant, not a setting: switching it is a release decision.
 */
export const ENFORCE_EXTENDED_FORM_VALIDATION = false;

export type CollectFormErrorsOptions = {
  /** Also run the extended rules (phone, dates, options, scale ranges, max files). */
  extended?: boolean;
};

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
  },
  options: CollectFormErrorsOptions = {},
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

  for (const field of incompleteDeviceExceptions(templateSchema, answers)) push({ fieldId: field.id, label: field.label, message: "Record a valid device status and an exception reason.", rule: "device" });

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
        isDeviceStatusField(field) ? "Choose the actual device status and give a reason for any exception." : field.type === "checkbox" ? "Tick this box to confirm." : "This field is required.",
      rule: "required",
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
      rule: "upload",
    });
  }

  for (const error of collectUploadMinimumErrors(templateSchema, answers, uploadCounts, property, laundryReady, noPhoto)) push(error);

  // 3) Additional answer rules.
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
              rule: "range",
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
            rule: "email",
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
              rule: "details",
            });
          }
        }
      }

      // Table / stock count shape, row limits and required cells.
      const structured = structuredAnswerError(field, answers[String(field.id)]);
      if (structured) push({ fieldId: String(field.id), sectionId, sectionLabel, label, ...structured });

      if (options.extended) {
        const extended = extendedFieldError(field, type, answers[String(field.id)], uploadCounts[String(field.id)] ?? 0);
        if (extended) push({ fieldId: String(field.id), sectionId, sectionLabel, label, ...extended });
      }
    }
  }

  return errors;
}

/* ── Extended rules ─────────────────────────────────────────────────────── */

const NUMERIC_TYPES = new Set(["number", "currency", "temperature", "counter"]);
const SCALE_DEFAULTS: Record<string, { min: number; max: number }> = {
  rating: { min: 1, max: 5 },
  slider: { min: 0, max: 10 },
  scale: { min: 1, max: 5 },
};
const PHONE_ALLOWED = /^[+]?[0-9 ()\-.]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

type ExtendedError = { message: string; rule: FormErrorRule };

/** A calendar date that really exists (2026-02-30 is refused). */
function isRealDate(value: string): boolean {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!PHONE_ALLOWED.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 15;
}

function dateError(type: string, answer: string): ExtendedError | null {
  const value = answer.trim();
  if (type === "date" && !(DATE_RE.test(value) && isRealDate(value))) return { message: "Enter a valid date.", rule: "date" };
  if (type === "time" && !TIME_RE.test(value)) return { message: "Enter a valid time.", rule: "date" };
  if (type === "datetime" && !(DATETIME_RE.test(value) && isRealDate(value))) return { message: "Enter a valid date and time.", rule: "date" };
  return null;
}

function optionError(field: { options?: unknown; allowOther?: unknown }, type: string, answer: unknown): ExtendedError | null {
  const options = Array.isArray(field.options) ? field.options.map(String) : [];
  if (field.allowOther === true) {
    // "Other" is stored as the typed text; any non-empty string is a valid answer.
    if (type === "multiselect") {
      return Array.isArray(answer) && answer.every((entry) => typeof entry === "string" && entry.trim())
        ? null
        : { message: "Choose from the list or type another answer.", rule: "option" };
    }
    return typeof answer === "string" ? null : { message: "Choose from the list or type another answer.", rule: "option" };
  }
  if (type === "multiselect") {
    const values = Array.isArray(answer) ? answer : [answer];
    return values.every((entry) => typeof entry === "string" && options.includes(entry))
      ? null
      : { message: "Choose only from the listed options.", rule: "option" };
  }
  return typeof answer === "string" && options.includes(answer) ? null : { message: "Choose one of the listed options.", rule: "option" };
}

function scaleError(field: { min?: unknown; max?: unknown; step?: unknown }, type: string, answer: unknown): ExtendedError | null {
  const num = typeof answer === "number" ? answer : Number(answer);
  if (!Number.isFinite(num)) return { message: "Enter a number.", rule: "scale-range" };
  const defaults = SCALE_DEFAULTS[type];
  const min = Number.isFinite(Number(field.min)) && field.min !== undefined && field.min !== null ? Number(field.min) : defaults.min;
  const max = Number.isFinite(Number(field.max)) && field.max !== undefined && field.max !== null ? Number(field.max) : defaults.max;
  if (num < min || num > max) return { message: `Choose a value between ${min} and ${max}.`, rule: "scale-range" };
  if (type === "rating" && !Number.isInteger(num)) return { message: "Choose a whole number of stars.", rule: "scale-range" };
  return null;
}

/**
 * One extended-rule error for an answered, visible field (empty answers are the
 * required rule's business). Exported for the field-type audit tests.
 */
export function extendedFieldError(
  field: { type?: unknown; options?: unknown; allowOther?: unknown; min?: unknown; max?: unknown; step?: unknown; maxFiles?: unknown },
  type: string,
  answer: unknown,
  uploadCount: number,
): ExtendedError | null {
  if (isUploadFieldType(type)) {
    const maxFiles = Number(field.maxFiles);
    if (Number.isFinite(maxFiles) && maxFiles > 0 && uploadCount > maxFiles) {
      return { message: `Add at most ${maxFiles} file${maxFiles === 1 ? "" : "s"} — ${uploadCount} added.`, rule: "max-files" };
    }
    return null;
  }
  if (isEmpty(answer)) return null;
  if (NUMERIC_TYPES.has(type)) {
    const num = typeof answer === "number" ? answer : Number(answer);
    return Number.isFinite(num) ? null : { message: "Enter a number.", rule: "number-format" };
  }
  if (type === "phone") {
    return typeof answer === "string" && isValidPhone(answer) ? null : { message: "Enter a valid phone number.", rule: "phone" };
  }
  if (type === "date" || type === "time" || type === "datetime") {
    return typeof answer === "string" ? dateError(type, answer) : { message: "Enter a valid date or time.", rule: "date" };
  }
  if (type === "select" || type === "radio" || type === "multiselect") return optionError(field, type, answer);
  if (type in SCALE_DEFAULTS) return scaleError(field, type, answer);
  return null;
}

/** The same visible-field minimum applies before submission and on the server. */
export function collectUploadMinimumErrors(
  templateSchema: any,
  answers: AnswerMap,
  uploadCounts: UploadCounts,
  property: Record<string, unknown>,
  laundryReady?: boolean,
  noPhoto?: { canUseNoPhoto: boolean; reasons: Record<string, { reasonCode: string } | undefined> }
): FormFieldError[] {
  const errors: FormFieldError[] = [];
  for (const section of Array.isArray(templateSchema?.sections) ? templateSchema.sections : []) {
    if (!isTemplateNodeVisible(section, answers, property, laundryReady)) continue;
    for (const field of flattenFieldsOneLevel(section?.fields)) {
      if (!field?.id || !isUploadFieldType(field.type) || !isFlattenedFieldVisible(field, answers, property, laundryReady)) continue;
      const id = String(field.id);
      const type = String(field.type).toLowerCase();
      const need = Math.max(field.required ? 1 : 0, type === "video" ? 0 : Number(field.minPhotos ?? 0));
      const have = uploadCounts[id] ?? 0;
      // A waiver excuses a missing capture, never an incomplete uploaded set.
      if (have === 0 && noPhoto?.canUseNoPhoto && noPhoto.reasons[id]) continue;
      if (!(need > have)) continue;
      errors.push({ fieldId: id, sectionId: section.id, sectionLabel: section.title || section.label,
        label: field.label || id, message: `Add at least ${need} ${type === "photo" ? "photo" : "file"}${need === 1 ? "" : "s"} — ${have} added.`, rule: "minimum" });
    }
  }
  return errors;
}

/**
 * Only the structured-type errors ("table", "stock-count") for the visible
 * questions — the submit route rejects these (they are new rules for new
 * types, see lib/forms/structured-answers.ts). Empty for a form without them.
 */
export function collectStructuredAnswerErrors(
  templateSchema: unknown,
  answers: AnswerMap,
  property: Record<string, unknown>,
  laundryReady?: boolean,
): FormFieldError[] {
  const errors: FormFieldError[] = [];
  const schema = templateSchema as { sections?: unknown } | null;
  for (const section of Array.isArray(schema?.sections) ? (schema!.sections as any[]) : []) {
    if (!isTemplateNodeVisible(section, answers, property, laundryReady)) continue;
    for (const field of flattenFieldsOneLevel(section?.fields)) {
      if (!field?.id || (field.type !== "table" && field.type !== "stock_count")) continue;
      if (!isFlattenedFieldVisible(field, answers, property, laundryReady)) continue;
      const problem = structuredAnswerError(field, answers[String(field.id)]);
      if (!problem) continue;
      errors.push({
        fieldId: String(field.id),
        sectionId: typeof section?.id === "string" ? section.id : undefined,
        sectionLabel: section?.title || section?.label,
        label: typeof field.label === "string" && field.label.trim() ? field.label.trim() : String(field.id),
        ...problem,
      });
    }
  }
  return errors;
}
