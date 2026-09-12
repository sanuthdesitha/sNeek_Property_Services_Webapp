import { resolveArrivalNotice } from "@/lib/jobs/arrival-notice";
import type { JobTimingBadges } from "@/lib/jobs/timing-badges";

export type TimingInput = {
  startTime?: string | null;
  dueTime?: string | null;
  timingBadges?: JobTimingBadges | null;
  sameDayCheckin?: boolean;
  sameDayCheckinTime?: string | null;
};
export function validTimingTime(value: unknown): string | null {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.trim()) ? value.trim() : null;
}
export function summarizeTiming(input: TimingInput) {
  const plannedStart = validTimingTime(input.startTime);
  const plannedFinish = validTimingTime(input.dueTime);
  const earliestAccess = validTimingTime(input.timingBadges?.late);
  const invalidEarly = Boolean(input.timingBadges?.early) && !validTimingTime(input.timingBadges?.early);
  // An invalid explicit override cannot safely fall back to the standard arrival.
  const arrival = invalidEarly ? { time: null, sameDay: true, early: true } : resolveArrivalNotice({
    earlyCheckinTime: validTimingTime(input.timingBadges?.early),
    sameDayActive: input.sameDayCheckin,
    sameDayTime: validTimingTime(input.sameDayCheckinTime),
  });
  const guestDeadline = arrival?.time ?? null;
  const warnings: string[] = [];
  if (earliestAccess && guestDeadline && earliestAccess >= guestDeadline) warnings.push("Guest timing leaves no cleaning window.");
  if (plannedStart && earliestAccess && plannedStart < earliestAccess) warnings.push("Planned start is before permitted guest access.");
  if (plannedFinish && guestDeadline && plannedFinish > guestDeadline) warnings.push("Planned finish is after the guest deadline.");
  const supplied = [input.startTime, input.dueTime, input.timingBadges?.late, input.timingBadges?.early,
    ...(input.sameDayCheckin ? [input.sameDayCheckinTime] : [])];
  if (supplied.some(value => value && !validTimingTime(value))) warnings.push("Some timing information is invalid.");
  return { plannedStart, plannedFinish, earliestAccess, guestDeadline, arrival, warnings };
}
