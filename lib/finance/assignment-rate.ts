/**
 * THE HOURLY RATE STAMPED ONTO AN ASSIGNMENT AT DISPATCH.
 *
 * `JobAssignment.payRate` is a snapshot, captured when somebody is put on a job
 * and read afterwards by every one of the eight things that compute pay. This is
 * the rule that decides what goes into it.
 *
 * PURE, AND SHARED, because there are SIX places that assign work:
 *
 *   1. the admin assign route
 *   2. bulk assign
 *   3. the automatic preferred-cleaner path on job creation (iCal)
 *   4. ops auto-dispatch          — lib/ops/dispatch.ts
 *   5. recurring job generation   — lib/ops/recurring.ts
 *   6. continuation handover      — lib/jobs/continuation-requests.ts
 *
 * A rule written out six times is a rule that gets updated five times. The
 * symptom would be quiet and specific: the same property paying one rate when a
 * job is assigned by hand and another when iCal created it.
 *
 * The first version of this module named only the first three, and 4–6 kept
 * their own `settings.cleanerJobHourlyRates?.[id]?.[type] ?? undefined` — which
 * is precisely the bug it was written to remove, still live in half the paths.
 * If a seventh appears, it belongs here too; `grep cleanerJobHourlyRates` is
 * how to check.
 *
 * PRECEDENCE:
 *   1. the per-cleaner, per-job-type rate — a deliberate arrangement with one
 *      person, which a property must not silently overwrite
 *   2. `Property.cleanerServiceRate` — a rate attached to the PLACE, so an
 *      awkward property pays more to whoever cleans it rather than the pay
 *      depending on who happened to turn up
 *   3. nothing — from here `computeCleanerPay` falls through to the person's own
 *      default and then the global one, flagging `rateMissing` if neither exists
 *
 * WHY THE PROPERTY RATE LANDS HERE and not inside `computeCleanerPay`: the pay
 * calculator receives a job, not a property, and all eight of its callers use a
 * narrow `select`. Threading a live property lookup through them would mean
 * eight queries that each have to remember one column — and the first that
 * forgot would make an invoice disagree with a payroll run about the same job.
 * Capturing it once at dispatch, where the per-cleaner rate is already captured,
 * means every reader gets it for free.
 *
 * `Property.cleanerServiceRate` was write-only dead config until this existed:
 * on the property form, saved by the API, documented in SYSTEM.md as overriding
 * the hourly maths, and read by nothing. An owner setting it saw no effect and
 * no error — the same shape as the three-hour pay bug.
 *
 * A STORED ZERO IS "NOT CONFIGURED", not "pays nothing". Neither the property
 * form nor the rate settings offer a way to mean a deliberate zero, so a 0 is an
 * empty box — and treating it as real would pay somebody nothing for turning up.
 */

/** A rate only counts when it is a real, positive number. */
function usableRate(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function resolveAssignmentPayRate(input: {
  /** settings.cleanerJobHourlyRates[cleanerId][jobType] */
  perCleanerRate?: number | null;
  /** Property.cleanerServiceRate */
  propertyCleanerServiceRate?: number | null;
}): number | null {
  // Deliberately NOT `??` on the per-cleaner rate: a 0 there is an empty setting
  // too, and letting it through would pin the assignment at zero and stop both
  // the property rate and the person's own rate from ever applying.
  return usableRate(input.perCleanerRate) ?? usableRate(input.propertyCleanerServiceRate) ?? null;
}
