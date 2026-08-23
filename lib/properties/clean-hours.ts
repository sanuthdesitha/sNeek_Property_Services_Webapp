/**
 * HOW LONG A CLEAN TAKES AT THIS PROPERTY — one answer, for every reader.
 *
 * There are three fields holding this, and nothing keeps them in step:
 *
 *   `assignedCleaningHours`                hours   — the first-class one
 *   `cleaningDurationMinutes`              minutes — QA baseline, job-start display
 *   `accessInfo.defaultCleanDurationHours` hours   — set at onboarding, legacy
 *
 * The property API writes all three independently from three separate form
 * inputs, so they CAN diverge. This module makes that harmless by ensuring every
 * reader picks the same one.
 *
 * THAT IS THE ACTUAL BUG. Three fields disagreeing matters only because
 * different code read different ones — which is exactly how a property could be
 * edited to 4 hours on its own page and still produce 3-hour jobs from iCal. The
 * pay bug was one instance; `resolveExpectedHours` in lib/jobs/window.ts was
 * another, quieter one, since it never consulted the legacy field at all and
 * returns null for a property carrying only that.
 *
 * PRECEDENCE, and the reasoning:
 *   1. `assignedCleaningHours` — the field the property page edits and the one
 *      the schema calls the first-class source. Whatever an owner most recently
 *      changed on purpose lives here.
 *   2. `cleaningDurationMinutes` — a real, deliberate value when set. Zero of
 *      nineteen properties currently carry one, but it is read in 45 places, so
 *      it stays ahead of the legacy field rather than being quietly demoted.
 *   3. `accessInfo.defaultCleanDurationHours` — captured at onboarding and never
 *      revisited. Last, because it is the value most likely to be stale: the
 *      property CREATE form defaults it to "3", which is where the three-hour
 *      jobs came from.
 *
 * A ZERO OR NEGATIVE VALUE IS NOT AN ANSWER at any level. None of the three
 * forms offers a way to mean "this clean takes no time", so a 0 is an empty box —
 * and treating it as real would produce a job with no allocated hours, which
 * pays nothing.
 *
 * PURE — no database.
 */

/** A duration only counts when it is a real, positive number. */
function usableHours(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface PropertyCleanHoursInput {
  assignedCleaningHours?: number | null;
  cleaningDurationMinutes?: number | null;
  /** The raw `Property.accessInfo` JSON, or the parsed object. */
  accessInfo?: unknown;
}

/** The legacy hours buried in the accessInfo blob, if any. */
export function legacyAccessInfoHours(accessInfo: unknown): number | null {
  if (!accessInfo || typeof accessInfo !== "object" || Array.isArray(accessInfo)) return null;
  return usableHours((accessInfo as Record<string, unknown>).defaultCleanDurationHours);
}

/**
 * How long a clean should take at this property, or null when nobody has said.
 *
 * Null rather than a default: "we have not been told" and "it takes three hours"
 * are different statements, and only one of them should quietly become
 * somebody's pay.
 */
export function resolvePropertyCleanHours(property: PropertyCleanHoursInput): number | null {
  const minutes = usableHours(property.cleaningDurationMinutes);
  return (
    usableHours(property.assignedCleaningHours) ??
    (minutes != null ? minutes / 60 : null) ??
    legacyAccessInfoHours(property.accessInfo)
  );
}

/**
 * The hours a JOB should use: its own value first, then the property's.
 *
 * A job's `estimatedHours` is what actually drives pay, and once set it is a
 * decision about THAT job — an admin editing one clean's hours must not have it
 * quietly reverted by the property's default on the next read.
 */
export function resolveJobCleanHours(
  job: { estimatedHours?: number | null },
  property: PropertyCleanHoursInput
): number | null {
  return usableHours(job.estimatedHours) ?? resolvePropertyCleanHours(property);
}

/**
 * Which field an answer came from — for a UI that wants to explain itself, and
 * for spotting properties still running on the onboarding default.
 */
export type CleanHoursSource = "ASSIGNED" | "DURATION_MINUTES" | "LEGACY_ACCESS_INFO" | "NONE";

export function cleanHoursSource(property: PropertyCleanHoursInput): CleanHoursSource {
  if (usableHours(property.assignedCleaningHours) != null) return "ASSIGNED";
  if (usableHours(property.cleaningDurationMinutes) != null) return "DURATION_MINUTES";
  if (legacyAccessInfoHours(property.accessInfo) != null) return "LEGACY_ACCESS_INFO";
  return "NONE";
}

/**
 * Do the three fields actually disagree?
 *
 * Nothing reconciles them on write, so they can drift. With every reader now
 * going through `resolvePropertyCleanHours` that drift is harmless — but it is
 * still worth being able to surface, because a property whose page says 4 hours
 * while its onboarding value says 3 is a property somebody will eventually argue
 * about.
 *
 * Compared at two decimal places: 90 minutes and 1.5 hours are the same answer
 * expressed differently, not a disagreement.
 */
export function cleanHoursDisagree(property: PropertyCleanHoursInput): boolean {
  const minutes = usableHours(property.cleaningDurationMinutes);
  const values = [
    usableHours(property.assignedCleaningHours),
    minutes != null ? minutes / 60 : null,
    legacyAccessInfoHours(property.accessInfo),
  ].filter((value): value is number => value != null);

  if (values.length < 2) return false;
  return new Set(values.map((value) => value.toFixed(2))).size > 1;
}
