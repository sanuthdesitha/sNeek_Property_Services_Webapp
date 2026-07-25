/**
 * Single source of truth for whether the cleaner laundry update applies to a
 * job. Previously this predicate was mirrored (inverted as `laundrySuppressed`)
 * in three places — the submit route, the standalone laundry-status route, and
 * the v2 cleaner workspace — and had to be kept in lockstep by hand.
 *
 * Rule: laundry only exists on Airbnb turnovers, never on rework/reclean jobs
 * (they reuse the original clean's linen), and only when the property hasn't
 * explicitly disabled laundry (`laundryEnabled === false`; missing/unknown
 * property data keeps laundry ON, matching the historical behaviour).
 *
 * Pure and dependency-free so both server routes and client components can
 * import it.
 */

export interface LaundryEligibilityJob {
  jobType?: string | null;
  isRework?: boolean | null;
}

export interface LaundryEligibilityProperty {
  laundryEnabled?: boolean | null;
}

export function isLaundryUpdateEligible(
  job: LaundryEligibilityJob | null | undefined,
  property: LaundryEligibilityProperty | null | undefined
): boolean {
  return (
    job?.jobType === "AIRBNB_TURNOVER" &&
    job?.isRework !== true &&
    property?.laundryEnabled !== false
  );
}
