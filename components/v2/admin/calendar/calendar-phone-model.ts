/**
 * Pure helpers for the phone calendar (board "Admin phone: Calendar", 2026-11):
 * the week strip's per-day facts and the "Move or reassign" sheet's cleaner
 * flags. Everything is read from the calendar response already on screen;
 * nothing here decides whether a move is allowed. The server check
 * (`/api/admin/calendar/check-move`) stays the only judge, and a fact that is
 * not loaded is reported as unknown, never as "free".
 *
 * Deliberately a plain module (no "use client"): tests read it directly.
 */
import { jobWindow, toMinutes } from "@/lib/jobs/cleaner-suggestions";
import { unavailabilityKind } from "@/lib/accounts/leave-rules";
import { listDays, viewRange } from "@/lib/calendar/range";
import type { CalendarJob, CalendarResponse, CalendarRow } from "@/lib/calendar/types";

/** The seven days (Monday first) of the week holding `cursor`. */
export function weekStripDays(cursor: string): string[] {
  const { start, end } = viewRange("week", cursor);
  return listDays(start, end);
}

type Window = { start: number; end: number };

function overlaps(a: Window, b: Window): boolean {
  return a.start < b.end && b.start < a.end;
}

/** True when two of one cleaner's jobs that day have known, overlapping times. */
export function cleanerHasClash(jobs: CalendarJob[]): boolean {
  const windows = jobs.map((job) => jobWindow(job)).filter((window): window is Window => window !== null);
  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      if (overlaps(windows[i], windows[j])) return true;
    }
  }
  return false;
}

export type WeekStripDay = {
  day: string;
  /** Jobs that day, or null when the loaded range does not cover the day. */
  jobs: number | null;
  /** Jobs that day with no cleaner. */
  unassigned: number;
  /** A cleaner has two jobs with known, overlapping times that day. */
  clash: boolean;
};

/** The week strip's facts for one day, from the loaded response only. */
export function weekStripDay(data: CalendarResponse | null, day: string): WeekStripDay {
  if (!data || !data.range.days.includes(day)) return { day, jobs: null, unassigned: 0, clash: false };
  const jobs = data.jobs.filter((job) => job.day === day);
  const byCleaner = new Map<string, CalendarJob[]>();
  for (const job of jobs) {
    for (const cleaner of job.cleaners) {
      const list = byCleaner.get(cleaner.id) ?? [];
      list.push(job);
      byCleaner.set(cleaner.id, list);
    }
  }
  const clash = Array.from(byCleaner.values()).some((list) => cleanerHasClash(list));
  return { day, jobs: jobs.length, unassigned: jobs.filter((job) => job.cleaners.length === 0).length, clash };
}

/** The job's window if it started at `startTime` instead (it keeps its length). */
export function shiftedWindow(job: CalendarJob, startTime: string | null): Window | null {
  const current = jobWindow(job);
  if (!current) return null;
  const proposed = toMinutes(startTime);
  if (proposed === null || startTime === job.startTime) return current;
  const length = current.end - current.start;
  return { start: proposed, end: Math.min(proposed + length, 24 * 60) };
}

export type CleanerFlag =
  | { kind: "unknown"; text: string }
  | { kind: "leave"; text: string }
  | { kind: "roster"; text: string }
  | { kind: "clash"; text: string }
  | { kind: "free"; text: string };

/**
 * What the loaded calendar says about giving `job` to `row` on `day` at
 * `startTime`. "unknown" when the day is not loaded. The server check runs
 * before anything is saved and may find more (it reads the live roster).
 */
export function cleanerFlag(data: CalendarResponse | null, row: CalendarRow, job: CalendarJob, day: string, startTime: string | null): CleanerFlag {
  if (!data || !data.range.days.includes(day)) return { kind: "unknown", text: "Not loaded; checked before saving" };
  const reason = row.unavailable[day];
  if (reason) {
    const kind = unavailabilityKind(reason);
    return kind === "roster" ? { kind: "roster", text: reason } : { kind: "leave", text: reason };
  }
  const window = shiftedWindow(job, startTime);
  const others = data.jobs.filter((other) => other.id !== job.id && other.day === day && other.cleaners.some((cleaner) => cleaner.id === row.id));
  if (window) {
    const clash = others.find((other) => {
      const otherWindow = jobWindow(other);
      return otherWindow !== null && overlaps(window, otherWindow);
    });
    if (clash) return { kind: "clash", text: `Clashes with ${clash.propertyName}${clash.startTime ? ` at ${clash.startTime}` : ""}` };
  }
  if (others.length === 0) return { kind: "free", text: "No other jobs that day" };
  return { kind: "free", text: `${others.length} other job${others.length === 1 ? "" : "s"} that day, no known overlap` };
}

export const CLEANER_FLAG_LABEL: Record<CleanerFlag["kind"], string> = {
  unknown: "Unknown",
  leave: "Leave",
  roster: "Not rostered",
  clash: "Clash",
  free: "Free",
};
