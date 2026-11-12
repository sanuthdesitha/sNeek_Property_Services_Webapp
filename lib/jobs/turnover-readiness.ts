import { TURNOVER_READY_BY_TIME } from "@/lib/scheduling-rules/constants";

/** Airbnb clean-ready deadline in the existing Sydney-local scheduling clock.
 * This is independent of the guest's actual booking/check-in time.
 */
export function airbnbReadinessDeadline(...arrivalTimes: Array<string | null | undefined>): string {
  return airbnbReadinessDeadlineBy(TURNOVER_READY_BY_TIME, ...arrivalTimes);
}

/** The same rule with the published "ready by" time (lib/scheduling-rules). */
export function airbnbReadinessDeadlineBy(readyBy: string, ...arrivalTimes: Array<string | null | undefined>): string {
  return arrivalTimes.reduce<string>((deadline, time) =>
    time && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && time < deadline ? time : deadline,
  readyBy);
}
