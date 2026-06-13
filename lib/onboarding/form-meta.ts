/**
 * Property onboarding "form meta" envelope.
 *
 * The Prisma schema for PropertyOnboardingSurvey has no dedicated columns for
 * several real-world STR scenario fields (geocode, selected job types, pets,
 * alarm/security, wifi, bin day, consumables, linen par levels, no-go areas,
 * recurring schedule, emergency contact, check-in/out times, preferred
 * cleaner). Per the "no schema changes" constraint we persist these as a
 * structured JSON envelope under a reserved `formMeta` key inside the survey's
 * `adminOverrides` JSON column. Admin approval overrides remain sibling
 * top-level keys (estimatedHours, cleanerCount, estimatedPrice, fixedPrice, …)
 * so the two never collide.
 *
 * This module is the single source of truth for reading/merging that envelope
 * so the create route, the update route, and the approval workflow all agree.
 */

export interface OnboardingFormMeta {
  // Geocode (carried from the address autocomplete) → Property lat/lng/placeId.
  propertyLatitude?: number | null;
  propertyLongitude?: number | null;
  propertyPlaceId?: string | null;

  // Cleaning types selected in the wizard → drives job drafts on approval.
  selectedJobTypes?: string[];

  // Scheduling defaults → Property.defaultCheckinTime/defaultCheckoutTime.
  defaultCheckinTime?: string | null;
  defaultCheckoutTime?: string | null;
  preferredCleanerUserId?: string | null;

  // Structured scenario blobs.
  scenarios?: Record<string, unknown> | null;
  recurringSchedule?: Record<string, unknown> | null;
  emergencyContact?: Record<string, unknown> | null;
}

// Keys on the validated survey body that belong in the formMeta envelope
// rather than as survey scalar columns.
const FORM_META_KEYS: (keyof OnboardingFormMeta)[] = [
  "propertyLatitude",
  "propertyLongitude",
  "propertyPlaceId",
  "selectedJobTypes",
  "defaultCheckinTime",
  "defaultCheckoutTime",
  "preferredCleanerUserId",
  "scenarios",
  "recurringSchedule",
  "emergencyContact",
];

type AnyRecord = Record<string, unknown>;

/** Read the formMeta envelope out of a survey's adminOverrides JSON. */
export function readFormMeta(adminOverrides: unknown): OnboardingFormMeta {
  if (adminOverrides && typeof adminOverrides === "object" && !Array.isArray(adminOverrides)) {
    const meta = (adminOverrides as AnyRecord).formMeta;
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      return meta as OnboardingFormMeta;
    }
  }
  return {};
}

/** Split admin approval overrides (siblings) from the formMeta envelope. */
export function readAdminOverrides(adminOverrides: unknown): AnyRecord {
  if (adminOverrides && typeof adminOverrides === "object" && !Array.isArray(adminOverrides)) {
    const { formMeta: _formMeta, ...rest } = adminOverrides as AnyRecord;
    return rest;
  }
  return {};
}

/**
 * Given the existing adminOverrides JSON and a validated survey body, return a
 * new adminOverrides object that merges any provided formMeta keys into the
 * reserved `formMeta` envelope while leaving sibling admin override keys
 * untouched. Returns `undefined` when nothing relevant was supplied so callers
 * can skip writing the column.
 */
export function buildFormMetaOverrides(
  body: AnyRecord,
  existingAdminOverrides?: unknown,
): AnyRecord | undefined {
  const provided: Partial<OnboardingFormMeta> = {};
  let touched = false;
  for (const key of FORM_META_KEYS) {
    if (body[key] !== undefined) {
      (provided as AnyRecord)[key] = body[key];
      touched = true;
    }
  }
  if (!touched) return undefined;

  const base =
    existingAdminOverrides && typeof existingAdminOverrides === "object" && !Array.isArray(existingAdminOverrides)
      ? { ...(existingAdminOverrides as AnyRecord) }
      : {};
  const existingMeta = readFormMeta(existingAdminOverrides);

  return {
    ...base,
    formMeta: { ...existingMeta, ...provided },
  };
}
