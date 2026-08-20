/**
 * When the next guest actually arrives, and how to say it once.
 *
 * Two facts describe the same event from different sources:
 *
 *   - `sameDayCheckin` comes off the job row (from the iCal sync) and carries
 *     the property's standard arrival time — 15:00 for most listings.
 *   - `earlyCheckin` is an admin-set rule saying THIS guest arrives sooner.
 *
 * The cleaner was shown both, as two separate banners, giving different times:
 * "guest arrives 15:00" directly above "finish before 12:00". The 15:00 is
 * simply wrong once an early check-in exists — it is the time that would have
 * applied had nobody moved it.
 *
 * An early check-in IS a same-day check-in that happens earlier, so this
 * collapses them into one notice and lets the early time win. Late checkout is
 * deliberately not part of this: it is the other end of the day, a different
 * instruction (do not START before), and both can be true at once.
 */

export interface ArrivalNotice {
  /** The deadline the property must be guest-ready by. "HH:mm", or null. */
  time: string | null;
  /** True when a guest checks in on the day of this clean. */
  sameDay: boolean;
  /** True when an admin moved the arrival earlier than the property default. */
  early: boolean;
}

function cleanTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveArrivalNotice(input: {
  earlyCheckinTime?: string | null;
  sameDayActive?: boolean;
  sameDayTime?: string | null;
}): ArrivalNotice | null {
  const early = cleanTime(input.earlyCheckinTime);
  const sameDay = input.sameDayActive === true;
  const sameDayTime = cleanTime(input.sameDayTime);

  if (!early && !sameDay) return null;

  return {
    // The early time wins. It is the one somebody deliberately set, and it is
    // always the tighter of the two — showing the looser one would tell a
    // cleaner they have hours they do not have.
    time: early ?? sameDayTime,
    // An early check-in means a guest is arriving today whether or not the
    // iCal flag came through, so it implies same-day.
    sameDay: sameDay || Boolean(early),
    early: Boolean(early),
  };
}
