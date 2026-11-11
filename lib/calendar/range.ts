/**
 * Calendar ranges as calendar-day keys (yyyy-MM-dd, both ends inclusive).
 *
 * `Job.scheduledDate` is stored as UTC midnight of the job's calendar day, so
 * a day key is read with `toISOString().slice(0, 10)` and a range becomes
 * `[startKey 00:00Z, endKey + 1 day 00:00Z)`. No timezone conversion is ever
 * applied to a stored calendar date. "Today" is the Sydney calendar day
 * (`sydneyTodayKey`), the organisation timezone used across the admin.
 *
 * Shared by the range endpoint and the page, so both agree on which days a
 * view covers.
 */
import { addDaysToKey, monthEndKey, monthStartKey, weekMondayKey } from "@/lib/time/sydney-range";

export const CALENDAR_VIEWS = ["day", "week", "month", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** The widest range one request may ask for (a month grid needs at most 31). */
export const MAX_CALENDAR_SPAN_DAYS = 45;
/** Agenda: a fortnight from the cursor day. */
export const AGENDA_DAYS = 14;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export class CalendarRangeError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "CalendarRangeError";
  }
}

export function isCalendarRangeError(error: unknown): error is CalendarRangeError {
  return error instanceof CalendarRangeError;
}

/** True for a real calendar date written as yyyy-MM-dd (rejects 2026-02-30). */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_KEY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** UTC midnight of a calendar day: the stored form of `Job.scheduledDate`. */
export function dayKeyToUtcDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** The calendar day a stored UTC-midnight date stands for. */
export function utcDateToDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Inclusive number of calendar days from start to end. */
export function spanDays(start: string, end: string): number {
  return Math.round((dayKeyToUtcDate(end).getTime() - dayKeyToUtcDate(start).getTime()) / 86_400_000) + 1;
}

export function listDays(start: string, end: string): string[] {
  const days: string[] = [];
  for (let key = start; key <= end; key = addDaysToKey(key, 1)) days.push(key);
  return days;
}

export type CalendarRange = { start: string; end: string };

/** Validate `?start&end`: real days, end not before start, at most 45 days. */
export function parseCalendarRange(start: string | null, end: string | null): CalendarRange {
  if (!isDayKey(start) || !isDayKey(end)) throw new CalendarRangeError("start and end must be dates written as YYYY-MM-DD.");
  if (end < start) throw new CalendarRangeError("end must not be before start.");
  if (spanDays(start, end) > MAX_CALENDAR_SPAN_DAYS) {
    throw new CalendarRangeError(`Ask for at most ${MAX_CALENDAR_SPAN_DAYS} days at a time.`);
  }
  return { start, end };
}

/** The days a view shows around the cursor day. */
export function viewRange(view: CalendarView, cursor: string): CalendarRange {
  switch (view) {
    case "day":
      return { start: cursor, end: cursor };
    case "week": {
      const monday = weekMondayKey(cursor);
      return { start: monday, end: addDaysToKey(monday, 6) };
    }
    case "month":
      return { start: monthStartKey(cursor), end: monthEndKey(cursor) };
    case "agenda":
      return { start: cursor, end: addDaysToKey(cursor, AGENDA_DAYS - 1) };
  }
}

/** Previous / next cursor for the view's step (a day, a week, a month, a fortnight). */
export function shiftCursor(view: CalendarView, cursor: string, direction: 1 | -1): string {
  switch (view) {
    case "day":
      return addDaysToKey(cursor, direction);
    case "week":
      return addDaysToKey(weekMondayKey(cursor), 7 * direction);
    case "agenda":
      return addDaysToKey(cursor, AGENDA_DAYS * direction);
    case "month": {
      const [year, month] = cursor.split("-").map(Number);
      const shifted = new Date(Date.UTC(year, month - 1 + direction, 1));
      return shifted.toISOString().slice(0, 10);
    }
  }
}

/** Month grid cells, Monday first, with null for the leading/trailing blanks. */
export function monthGridCells(cursor: string): Array<string | null> {
  const { start, end } = viewRange("month", cursor);
  const lead = (dayKeyToUtcDate(start).getUTCDay() + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  cells.push(...listDays(start, end));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parts(key: string) {
  const date = dayKeyToUtcDate(key);
  return { weekday: date.getUTCDay(), day: date.getUTCDate(), month: date.getUTCMonth(), year: date.getUTCFullYear() };
}

/** "Mon 9" — week grid column heading. */
export function shortDayLabel(key: string): string {
  const p = parts(key);
  return `${WEEKDAY_SHORT[p.weekday]} ${p.day}`;
}

/** "Fri 13 Nov" — used in the move confirmation. */
export function mediumDayLabel(key: string): string {
  const p = parts(key);
  return `${WEEKDAY_SHORT[p.weekday]} ${p.day} ${MONTH_SHORT[p.month]}`;
}

/** "Wednesday 11 November" — day headings. */
export function longDayLabel(key: string): string {
  const p = parts(key);
  return `${WEEKDAY_LONG[p.weekday]} ${p.day} ${MONTH_LONG[p.month]}`;
}

export function weekdayShort(key: string): string {
  return WEEKDAY_SHORT[parts(key).weekday];
}

export function dayOfMonth(key: string): number {
  return parts(key).day;
}

/** The phrase that opens the header summary for a view and cursor. */
export function rangeHeading(view: CalendarView, cursor: string): string {
  const range = viewRange(view, cursor);
  const start = parts(range.start);
  const end = parts(range.end);
  switch (view) {
    case "day":
      return longDayLabel(cursor);
    case "week":
      return `Week of ${start.day} ${MONTH_LONG[start.month]}${start.year !== end.year ? ` ${start.year}` : ""}`;
    case "month":
      return `${MONTH_LONG[start.month]} ${start.year}`;
    case "agenda":
      return start.month === end.month
        ? `${start.day} – ${end.day} ${MONTH_LONG[end.month]}`
        : `${start.day} ${MONTH_SHORT[start.month]} – ${end.day} ${MONTH_SHORT[end.month]}`;
  }
}
