import { applyJobTimingRules, type JobTimingRule } from "@/lib/jobs/meta";

/**
 * Resolve the final startTime/dueTime for a reservation-driven (iCal) turnover
 * job by running the reservation-derived raw candidates through the job's
 * admin timing rules:
 *   - startTime candidate = previous guest's checkout (or property default)
 *   - dueTime candidate   = same-day check-in time (or property default)
 *   - a late-checkout rule overrides startTime; an early-checkin rule
 *     overrides dueTime (see applyJobTimingRules).
 *
 * This is the single choke point both iCal sync paths (create + re-sync
 * update) go through so the "Late checkout 12:30" label and the actual
 * start/due columns can never diverge after a sync. Pure — no IO.
 */
export function resolveJobTimesFromReservation(input: {
  /** Raw start-time candidate derived from the reservation checkout (HH:MM). */
  reservationStartTime: string | null | undefined;
  /** Raw due-time candidate derived from the same-day check-in (HH:MM). */
  reservationDueTime: string | null | undefined;
  earlyCheckin: JobTimingRule;
  lateCheckout: JobTimingRule;
}): { startTime: string | null; dueTime: string | null } {
  const applied = applyJobTimingRules({
    startTime: input.reservationStartTime,
    dueTime: input.reservationDueTime,
    earlyCheckin: input.earlyCheckin,
    lateCheckout: input.lateCheckout,
  });

  // applyJobTimingRules normalizes to strict HH:MM and returns undefined for
  // anything else. Fall back to the raw reservation value rather than erase a
  // time the sync previously stored.
  return {
    startTime: applied.startTime ?? input.reservationStartTime ?? null,
    dueTime: applied.dueTime ?? input.reservationDueTime ?? null,
  };
}
