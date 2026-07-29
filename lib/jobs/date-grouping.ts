import { formatInTimeZone } from "date-fns-tz";
import { SYDNEY_TZ, addDaysToKey, sydneyDateKey, sydneyTodayKey } from "@/lib/time/sydney-range";

/**
 * Sydney-day agenda grouping for the jobs list.
 *
 * Groups a (pre-sorted) list of jobs by their Australia/Sydney calendar day,
 * preserving input order both across groups (first-appearance order) and within
 * each group. Jobs without a usable scheduled date always sort last under a
 * single "No date" bucket.
 *
 * Labels (en-AU, Sydney): "Today · Fri 25 Jul", "Tomorrow · Sat 26 Jul",
 * otherwise "Fri 1 Aug".
 */

export const NO_DATE_KEY = "no-date";

export type JobDayGroup<T> = {
  /** yyyy-MM-dd Sydney day key, or "no-date" for the trailing bucket. */
  dayKey: string;
  label: string;
  jobs: T[];
};

function toDate(value: string | Date | null): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Fri 25 Jul" for a yyyy-MM-dd Sydney day key. */
function dayLabel(dayKey: string): string {
  // Noon Sydney keeps the formatted day stable regardless of DST offset.
  return formatInTimeZone(new Date(`${dayKey}T12:00:00+10:00`), SYDNEY_TZ, "EEE d MMM");
}

/**
 * Compact relative Sydney-day label for chips/cards: "Today", "Tomorrow",
 * otherwise "Fri 1 Aug". Shared by the jobs agenda and the laundry boards so
 * every surface names days the same way.
 */
export function sydneyRelativeDayLabel(dayKey: string, now: Date = new Date()): string {
  const todayKey = sydneyTodayKey(now);
  if (dayKey === todayKey) return "Today";
  if (dayKey === addDaysToKey(todayKey, 1)) return "Tomorrow";
  return dayLabel(dayKey);
}

export function groupJobsBySydneyDay<T extends { scheduledDate: string | Date | null }>(
  jobs: T[],
  now: Date,
): Array<JobDayGroup<T>> {
  const todayKey = sydneyTodayKey(now);
  const tomorrowKey = addDaysToKey(todayKey, 1);

  const groups = new Map<string, JobDayGroup<T>>();
  const noDate: JobDayGroup<T> = { dayKey: NO_DATE_KEY, label: "No date", jobs: [] };

  for (const job of jobs) {
    const date = toDate(job.scheduledDate);
    if (!date) {
      noDate.jobs.push(job);
      continue;
    }
    const dayKey = sydneyDateKey(date);
    let group = groups.get(dayKey);
    if (!group) {
      const base = dayLabel(dayKey);
      const label =
        dayKey === todayKey ? `Today · ${base}` : dayKey === tomorrowKey ? `Tomorrow · ${base}` : base;
      group = { dayKey, label, jobs: [] };
      groups.set(dayKey, group);
    }
    group.jobs.push(job);
  }

  const out = Array.from(groups.values());
  if (noDate.jobs.length > 0) out.push(noDate);
  return out;
}
