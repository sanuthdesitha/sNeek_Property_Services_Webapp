/**
 * The Jobs table's day group row, as drawn: "Thursday 12 November" (weekday,
 * day, month) in the organisation timezone (Australia/Sydney). Today is flagged
 * separately so the row can mark it the way the Calendar marks its day header
 * ("· today"); there is no "Today"/"Tomorrow" prefix. Pure.
 */
import { formatInTimeZone } from "date-fns-tz";
import { SYDNEY_TZ, sydneyTodayKey } from "@/lib/time/sydney-range";

export type JobsDayGroupLabel = { text: string; isToday: boolean };

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** `dayKey` is a yyyy-MM-dd Sydney calendar day; it is never shifted. */
export function jobsDayGroupLabel(dayKey: string, now: Date = new Date()): JobsDayGroupLabel {
  if (!DAY_KEY.test(dayKey)) return { text: "No date", isToday: false };
  // Noon UTC of the key is the same calendar day in Sydney at any offset.
  const text = formatInTimeZone(new Date(`${dayKey}T12:00:00.000Z`), SYDNEY_TZ, "EEEE d MMMM");
  return { text, isToday: dayKey === sydneyTodayKey(now) };
}
