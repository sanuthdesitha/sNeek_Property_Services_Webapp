/**
 * Team leave view (board "Workforce" tab 3, phone list on M-Workforce): the
 * shape of a window of days and the rows of the grid. Leave and days off come
 * from StaffLeave; "usually unavailable" is the weekly pattern in the
 * CleanerAvailability table, shown only (owner default 2026-11-16, pending
 * owner confirmation): it does not block or change cleaner suggestions.
 *
 * PURE: no DB, no I/O. Plain module, safe for server pages and clients.
 */

export type TeamLeaveEntry = {
  id: string;
  userId: string;
  kind: "LEAVE" | "DAY_OFF";
  startDate: string;
  endDate: string;
  note: string | null;
  /** Live jobs this person is assigned to inside the leave; null when it could not be counted. */
  jobsNeedingCover: number | null;
};

export type WeeklyUnavailable = {
  /** 0 = Sunday … 6 = Saturday (JavaScript weekday numbering, as stored). */
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  note: string | null;
};

export type TeamLeavePerson = {
  id: string;
  name: string;
  role: string;
  leave: TeamLeaveEntry[];
  usuallyUnavailable: WeeklyUnavailable[];
};

export type LeaveWindow = { start: string; end: string; days: string[] };

const DAY_MS = 86_400_000;

export function addDays(key: string, count: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

/** Monday of the week holding `key`. */
export function mondayOf(key: string): string {
  const weekday = weekdayOf(key);
  return addDays(key, weekday === 0 ? -6 : 1 - weekday);
}

export function leaveWindow(start: string, length: number): LeaveWindow {
  const days = Array.from({ length }, (_, index) => addDays(start, index));
  return { start, end: days[days.length - 1], days };
}

export function isDayKey(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export type DayCell =
  | { kind: "leave"; entry: TeamLeaveEntry; first: boolean }
  | { kind: "usual"; pattern: WeeklyUnavailable }
  | { kind: "none" };

/** What one person's cell on one day shows. Recorded leave wins over the weekly pattern. */
export function cellFor(person: TeamLeavePerson, day: string, windowStart: string): DayCell {
  const entry = person.leave.find((row) => row.startDate <= day && row.endDate >= day);
  if (entry) return { kind: "leave", entry, first: day === entry.startDate || day === windowStart };
  const pattern = person.usuallyUnavailable.find((row) => row.dayOfWeek === weekdayOf(day));
  return pattern ? { kind: "usual", pattern } : { kind: "none" };
}

const WEEKDAY_NAME = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "Sundays", "Mondays 06:00–12:00". */
export function patternWords(pattern: WeeklyUnavailable): string {
  const allDay = pattern.startTime <= "00:00" && pattern.endTime >= "23:59";
  return allDay ? WEEKDAY_NAME[pattern.dayOfWeek] : `${WEEKDAY_NAME[pattern.dayOfWeek]} ${pattern.startTime}–${pattern.endTime}`;
}

/** Jobs list link for "N jobs need cover": that person, those days, in Jobs. */
export function coverHref(entry: Pick<TeamLeaveEntry, "userId" | "startDate" | "endDate">): string {
  const params = new URLSearchParams({ cleanerId: entry.userId, dateFrom: entry.startDate, dateTo: entry.endDate });
  return `/v2/admin/jobs?${params.toString()}`;
}

export function coverWords(count: number | null): string | null {
  if (count === null) return "jobs not counted";
  if (count === 0) return null;
  return `${count} job${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} cover`;
}

/** Phone list: entries grouped by their day range, in date order. */
export function leaveByRange(people: readonly TeamLeavePerson[]): Array<{ startDate: string; endDate: string; items: Array<{ person: TeamLeavePerson; entry: TeamLeaveEntry }> }> {
  const groups = new Map<string, { startDate: string; endDate: string; items: Array<{ person: TeamLeavePerson; entry: TeamLeaveEntry }> }>();
  for (const person of people) {
    for (const entry of person.leave) {
      const key = `${entry.startDate}:${entry.endDate}`;
      const group = groups.get(key) ?? { startDate: entry.startDate, endDate: entry.endDate, items: [] };
      group.items.push({ person, entry });
      groups.set(key, group);
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
}
