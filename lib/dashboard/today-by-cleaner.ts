/**
 * "Today by cleaner": today's jobs per cleaner on an hour axis, from the Live
 * ops board rows (real scheduled start times and live states). Pure.
 */
import type { LiveJobRow, LiveJobState } from "@/lib/ops/live-board-types";
import type { StripRow, StripSegment, StripState, TodayByCleanerPayload } from "./command-types";

/** Default axis (hours, organisation timezone); widened to fit the day's jobs. */
export const STRIP_DEFAULT_START_HOUR = 8;
export const STRIP_DEFAULT_END_HOUR = 18;
/** Drawn length for a job with no end, due time or allocation (marked as assumed). */
export const STRIP_ASSUMED_MINUTES = 60;

function minuteOf(hhmm: string | null): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm.trim())) return null;
  const [h, m] = hhmm.trim().split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function stripState(state: LiveJobState, hasCleaner: boolean): StripState {
  if (!hasCleaner && (state === "planned" || state === "not-started")) return "unassigned";
  if (state === "done") return "done";
  return state;
}

const STATE_TEXT: Record<StripState, string> = {
  done: "Done",
  "on-site": "On site",
  late: "Late",
  planned: "Planned",
  unassigned: "Unassigned",
  travelling: "Travelling",
  "not-started": "Not started",
  "off-site": "Off site",
};

export function stripStateLabel(state: StripState): string {
  return STATE_TEXT[state];
}

function segmentFor(row: LiveJobRow): StripSegment | null {
  const start = minuteOf(row.startTime);
  if (start == null) return null;
  const due = minuteOf(row.dueTime);
  let end: number;
  let assumed = false;
  if (row.allocatedMinutes) end = start + row.allocatedMinutes;
  else if (due != null && due > start) end = due;
  else {
    end = start + STRIP_ASSUMED_MINUTES;
    assumed = true;
  }
  const state = stripState(row.state, row.cleaners.length > 0);
  return {
    jobId: row.jobId,
    startMinute: start,
    endMinute: Math.min(end, 24 * 60),
    lengthAssumed: assumed,
    state,
    label: `${row.propertyName} · ${row.startTime}${assumed ? "" : `–${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`} · ${STATE_TEXT[state]}`,
  };
}

export function buildTodayByCleaner(rows: LiveJobRow[], nowMinute: number): TodayByCleanerPayload {
  const byCleaner = new Map<string, StripRow>();
  const unassigned: StripRow = { key: "unassigned", name: "Unassigned", unassigned: true, segments: [] };
  let withoutStartTime = 0;
  let minMinute = STRIP_DEFAULT_START_HOUR * 60;
  let maxMinute = STRIP_DEFAULT_END_HOUR * 60;
  for (const row of rows) {
    const segment = segmentFor(row);
    if (!segment) {
      withoutStartTime += 1;
      continue;
    }
    minMinute = Math.min(minMinute, segment.startMinute);
    maxMinute = Math.max(maxMinute, segment.endMinute);
    if (row.cleaners.length === 0) {
      unassigned.segments.push(segment);
      continue;
    }
    for (const cleaner of row.cleaners) {
      const entry = byCleaner.get(cleaner.id) ?? { key: cleaner.id, name: cleaner.name, unassigned: false, segments: [] };
      entry.segments.push(segment);
      byCleaner.set(cleaner.id, entry);
    }
  }
  const sorted = Array.from(byCleaner.values()).sort((a, b) => a.name.localeCompare(b.name));
  if (unassigned.segments.length > 0) sorted.push(unassigned);
  return {
    axisStartHour: Math.floor(minMinute / 60),
    axisEndHour: Math.min(24, Math.ceil(maxMinute / 60)),
    rows: sorted,
    withoutStartTime,
    nowMinute,
  };
}
