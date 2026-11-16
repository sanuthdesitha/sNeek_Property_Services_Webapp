/**
 * Guest-timing TAGS for office screens: the words a row, card or header shows
 * for late checkout, early check-in and same-day check-in.
 *
 * The office list used to show "EARLY 13:00" / "LATE 11:00". Both read as a
 * time with a code word, and they mean opposite things: EARLY is a deadline
 * ("guest-ready by"), LATE is a gate ("do not start before"). These tags say
 * the instruction in words, in the same wording the cleaner sees.
 *
 * Input is the server-derived `timingBadges` (lib/jobs/timing-badges.ts, the
 * single parse of the job's rules) plus the job row's own same-day check-in
 * columns. Same-day check-in is merged with early check-in the way the
 * cleaner's notice does (lib/jobs/arrival-notice.ts): the early time wins.
 *
 * PURE: no notes parsing, no I/O, safe on client and server.
 */
import { resolveArrivalNotice } from "@/lib/jobs/arrival-notice";
import type { JobTimingBadges } from "@/lib/jobs/timing-badges";
import { validTimingTime } from "@/lib/jobs/timing-summary";

export type TimingTagKey = "late" | "early" | "sameDay";

export type TimingTagTone = "danger" | "warning";

export interface TimingTag {
  key: TimingTagKey;
  /** The full sentence-case tag, e.g. "Late checkout · start after 11:00". */
  label: string;
  tone: TimingTagTone;
  /** The readable HH:MM the tag states, or null when there is none to state. */
  time: string | null;
  /** True when a rule is on but its stored time could not be read. */
  invalid: boolean;
}

export interface TimingTagInput {
  timingBadges?: JobTimingBadges | null;
  /** The job row's same-day check-in flag (iCal sync). */
  sameDayCheckin?: boolean | null;
  /** The job row's same-day arrival time, "HH:mm" as stored. */
  sameDayCheckinTime?: string | null;
}

export const TIMING_TIME_UNREADABLE = "time could not be read";

function lateTag(badges: JobTimingBadges | null | undefined): TimingTag | null {
  const raw = badges?.late;
  const time = validTimingTime(raw);
  if (time) return { key: "late", label: `Late checkout · start after ${time}`, tone: "danger", time, invalid: false };
  if (badges?.lateInvalid || raw) {
    return { key: "late", label: `Late checkout · ${TIMING_TIME_UNREADABLE}`, tone: "danger", time: null, invalid: true };
  }
  return null;
}

function arrivalTag(input: TimingTagInput): TimingTag | null {
  const badges = input.timingBadges;
  const earlyTime = validTimingTime(badges?.early);
  if (!earlyTime && (badges?.earlyInvalid || badges?.early)) {
    // Never fall back to the property's standard arrival: the override exists
    // because this guest is NOT arriving at the standard time.
    return { key: "early", label: `Early check-in · ${TIMING_TIME_UNREADABLE}`, tone: "danger", time: null, invalid: true };
  }
  const sameDayActive = input.sameDayCheckin === true;
  const sameDayRaw = typeof input.sameDayCheckinTime === "string" ? input.sameDayCheckinTime.trim() : "";
  const sameDayTime = validTimingTime(sameDayRaw);
  const arrival = resolveArrivalNotice({ earlyCheckinTime: earlyTime, sameDayActive, sameDayTime });
  if (!arrival) return null;
  if (arrival.early && arrival.time) {
    return { key: "early", label: `Early check-in · ready by ${arrival.time}`, tone: "warning", time: arrival.time, invalid: false };
  }
  if (arrival.time) {
    return { key: "sameDay", label: `Same-day check-in · ready by ${arrival.time}`, tone: "warning", time: arrival.time, invalid: false };
  }
  if (sameDayRaw) {
    return { key: "sameDay", label: `Same-day check-in · ${TIMING_TIME_UNREADABLE}`, tone: "warning", time: null, invalid: true };
  }
  return { key: "sameDay", label: "Same-day check-in · arrival time not confirmed", tone: "warning", time: null, invalid: false };
}

/**
 * The tags for one job, late checkout first (walking in on guests is the
 * mistake that cannot be undone), then the arrival deadline.
 */
export function timingTagsFor(input: TimingTagInput): TimingTag[] {
  const tags: TimingTag[] = [];
  const late = lateTag(input.timingBadges);
  if (late) tags.push(late);
  const arrival = arrivalTag(input);
  if (arrival) tags.push(arrival);
  return tags;
}

/** Only the admin-set rules (late checkout, early check-in), for places that show same-day arrival separately. */
export function timingRuleTagsFor(badges: JobTimingBadges | null | undefined): TimingTag[] {
  return timingTagsFor({ timingBadges: badges }).filter((tag) => tag.key !== "sameDay");
}

/** "Late checkout · start after 11:00; Early check-in · ready by 13:00" for titles and screen-reader labels. */
export function timingTagsSentence(tags: TimingTag[]): string {
  return tags.map((tag) => tag.label).join("; ");
}
