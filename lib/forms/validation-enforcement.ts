/**
 * "Reject submissions that break these checks" — the organisation switch for
 * the extended answer rules (EXTENDED_FORM_RULES: ranges, email, phone, dates,
 * option membership, details-when-No, scale ranges, maximum files).
 *
 * Stored in the app settings JSON as `formValidation` (no schema change).
 * Default and fallback when unreadable: ENFORCE_EXTENDED_FORM_VALIDATION
 * (false), so at launch nothing new is rejected — violations are recorded on
 * the submission as warnings.
 *
 * IN-FLIGHT WORK: when enforcement is on, a submission is still accepted with
 * warnings if the cleaner STARTED the job before the moment enforcement was
 * switched on. "Started" = the cleaner's earliest clock-in (TimeLog.startedAt)
 * on that job — a server timestamp every submission has (the submit route
 * refuses a job that was never started); the client's own form start time is
 * not trusted. No clock-in found → accepted with warnings (never stricter on a
 * missing fact).
 *
 * PURE.
 */
import { ENFORCE_EXTENDED_FORM_VALIDATION } from "./validate-submission";

export type FormValidationSettings = {
  enforceExtended: boolean;
  /** When enforcement was last switched on (ISO); null while off. */
  enforcedSince: string | null;
};

export const DEFAULT_FORM_VALIDATION_SETTINGS: FormValidationSettings = {
  enforceExtended: ENFORCE_EXTENDED_FORM_VALIDATION,
  enforcedSince: null,
};

export function sanitizeFormValidationSettings(raw: unknown): FormValidationSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_FORM_VALIDATION_SETTINGS;
  const node = raw as Record<string, unknown>;
  if (typeof node.enforceExtended !== "boolean") return DEFAULT_FORM_VALIDATION_SETTINGS;
  const since = typeof node.enforcedSince === "string" && Number.isFinite(Date.parse(node.enforcedSince)) ? node.enforcedSince : null;
  // Enforcement without a known switch-on moment cannot protect in-flight
  // work, so it is read as off rather than guessed.
  if (node.enforceExtended && !since) return DEFAULT_FORM_VALIDATION_SETTINGS;
  return { enforceExtended: node.enforceExtended, enforcedSince: node.enforceExtended ? since : null };
}

/** Apply a switch change: switching on stamps `now`; switching off clears it. */
export function nextFormValidationSettings(current: FormValidationSettings, enforce: boolean, now: Date): FormValidationSettings {
  if (enforce === current.enforceExtended) return current;
  return enforce ? { enforceExtended: true, enforcedSince: now.toISOString() } : { enforceExtended: false, enforcedSince: null };
}

/** Whether THIS submission is held to the extended rules. */
export function shouldEnforceExtended(settings: FormValidationSettings | null | undefined, workStartedAt: Date | null): boolean {
  const effective = settings ?? DEFAULT_FORM_VALIDATION_SETTINGS;
  if (!effective.enforceExtended || !effective.enforcedSince) return false;
  if (!workStartedAt) return false;
  return workStartedAt.getTime() >= Date.parse(effective.enforcedSince);
}
