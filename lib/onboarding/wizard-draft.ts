/**
 * New onboarding survey drafts (owner decision 2026-11-14, "do what's best").
 *
 * Opening /v2/admin/onboarding/new used to POST an empty survey at once, so
 * every visit left a blank DRAFT behind. The wizard now creates the draft on
 * the first save: the first autosave after the person has entered something,
 * or Next / Save Draft with something entered. The create request carries an
 * idempotency key that stays the same for every retry from that wizard, so a
 * retry after an uncertain failure returns the draft that was already made
 * instead of making a second one.
 *
 * Plain module (no "use client", no server imports): the wizard and the
 * create route read the same rules.
 */

/** Header the create request sends; the route keeps it as `adminOverrides.draftCreateKey`. */
export const ONBOARDING_DRAFT_KEY_HEADER = "Idempotency-Key";

/** Reserved sibling key inside the survey's `adminOverrides` JSON (next to `formMeta`). */
export const ONBOARDING_DRAFT_KEY_FIELD = "draftCreateKey";

/** Wait after the last edit before the first autosave creates the draft. */
export const ONBOARDING_FIRST_SAVE_DELAY_MS = 1500;

const DRAFT_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

/** A well-formed idempotency key, or null (a missing or malformed key is ignored, never trusted). */
export function readOnboardingDraftKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return DRAFT_KEY_PATTERN.test(value) ? value : null;
}

/** A fresh idempotency key for one new-survey wizard. */
export function newOnboardingDraftKey(): string {
  const cryptoApi = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return `onb-${cryptoApi.randomUUID()}`;
  return `onb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/** True when a value holds something the person entered (not just an empty shell). */
function holdsEnteredValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(holdsEnteredValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(holdsEnteredValue);
  return false;
}

/**
 * Whether the wizard's form holds anything worth saving as a draft. An
 * untouched form, or one with only empty strings, false switches and empty
 * lists, is not: saving it would only leave a blank draft behind.
 */
export function hasOnboardingDraftContent(formData: Readonly<Record<string, unknown>>): boolean {
  return Object.values(formData).some(holdsEnteredValue);
}

type ValidationIssue = { path?: unknown; message?: unknown };

/**
 * A readable reason for a refused save. The routes answer validation errors
 * with the raw issue list as `error`; show the first issue instead of JSON.
 */
export function describeOnboardingSaveError(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const text = raw.trim();
  if (!text.startsWith("[")) return text;
  try {
    const issues = JSON.parse(text) as ValidationIssue[];
    const first = Array.isArray(issues) ? issues[0] : null;
    if (!first || typeof first.message !== "string") return fallback;
    const path = Array.isArray(first.path) ? first.path.filter((part) => typeof part === "string" || typeof part === "number").join(".") : "";
    return path ? `Check ${path}: ${first.message}` : first.message;
  } catch {
    return fallback;
  }
}
