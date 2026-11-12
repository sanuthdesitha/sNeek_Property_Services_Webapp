/**
 * Day view time axis: where each job sits on an hour track. Pure.
 *
 * A job is placed from its start time to its end, due time or estimated
 * duration (`jobWindow`); with a start but no known end it is drawn one hour
 * wide and marked `openEnded`. A job with no start time is listed apart
 * ("No time"), never placed at an invented hour. Overlapping jobs in one row
 * take separate slots so none is hidden.
 */
import { jobWindow, toMinutes } from "@/lib/jobs/cleaner-suggestions";
import type { CalendarJob } from "./types";

export type AxisBounds = { startHour: number; endHour: number };
export type PlacedJob = { job: CalendarJob; start: number; end: number; openEnded: boolean; slot: number };

const DEFAULT_BOUNDS: AxisBounds = { startHour: 6, endHour: 20 };

function place(job: CalendarJob): { start: number; end: number; openEnded: boolean } | null {
  const window = jobWindow(job);
  if (window) return { start: window.start, end: window.end, openEnded: false };
  const start = toMinutes(job.startTime);
  return start === null ? null : { start, end: Math.min(start + 60, 24 * 60), openEnded: true };
}

export function axisBounds(jobs: CalendarJob[]): AxisBounds {
  let { startHour, endHour } = DEFAULT_BOUNDS;
  for (const job of jobs) {
    const placed = place(job);
    if (!placed) continue;
    startHour = Math.min(startHour, Math.floor(placed.start / 60));
    endHour = Math.max(endHour, Math.ceil(placed.end / 60));
  }
  return { startHour, endHour: Math.min(24, Math.max(endHour, startHour + 1)) };
}

export function layoutDayRow(jobs: CalendarJob[]): { placed: PlacedJob[]; untimed: CalendarJob[]; slots: number } {
  const untimed: CalendarJob[] = [];
  const items: Omit<PlacedJob, "slot">[] = [];
  for (const job of jobs) {
    const placed = place(job);
    if (placed) items.push({ job, ...placed });
    else untimed.push(job);
  }
  items.sort((a, b) => a.start - b.start || a.end - b.end);
  const slotEnds: number[] = [];
  const placed = items.map((item) => {
    let slot = slotEnds.findIndex((end) => end <= item.start);
    if (slot === -1) {
      slot = slotEnds.length;
      slotEnds.push(item.end);
    } else {
      slotEnds[slot] = item.end;
    }
    return { ...item, slot };
  });
  return { placed, untimed, slots: Math.max(1, slotEnds.length) };
}
