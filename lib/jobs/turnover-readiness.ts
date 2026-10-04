/** Airbnb clean-ready deadline in the existing Sydney-local scheduling clock.
 * This is independent of the guest's actual booking/check-in time.
 */
export function airbnbReadinessDeadline(...arrivalTimes: Array<string | null | undefined>): string {
  return arrivalTimes.reduce<string>((deadline, time) =>
    time && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && time < deadline ? time : deadline,
  "15:00");
}
