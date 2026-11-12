/**
 * Which laundry runs belong to a date range: the ONE rule behind the Runs
 * board's pickup and drop-off loops, and (owner decision 2026-11-13) the
 * laundry portal's Today page. Plain module, no server imports: the Runs board
 * (browser) and the Today page (server) both call `classifyRuns` on tasks from
 * the same feed query (`fetchLaundryWeekTasks`).
 *
 * - Pickup loop: sets still to collect or collected (PENDING, CONFIRMED,
 *   FLAGGED, PICKED_UP, READY_TO_RETURN) whose pickup is scheduled in range. A
 *   failed pickup today is FLAGGED with today's pickup date, so it shows,
 *   marked; a flagged or failed set from another day does not.
 * - Drop-off loop: picked-up sets due back by the end of the range, plus
 *   returns completed within the range.
 * - "No pickup required" sets are never runs.
 */
import { addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";

export type RunRange = { start: Date; endExclusive: Date; days: number };

export type RunTaskFacts = {
  status: string;
  pickupDate: string | Date;
  dropoffDate: string | Date;
  droppedAt?: string | Date | null;
  noPickupRequired?: boolean | null;
};

export function classifyRuns<T extends RunTaskFacts>(tasks: readonly T[], range: Pick<RunRange, "start" | "endExclusive">): { pickups: T[]; dropoffs: T[] } {
  // Key-lost tasks have pickupDate === dropoffDate (same-day, on the clean
  // day). They flow through both loops SEQUENTIALLY by design: while still
  // PENDING/CONFIRMED they sit in the pickup loop only; the moment the driver
  // marks them PICKED_UP they join the drop-off loop for the same visit.
  const inRange = (d: Date) => d >= range.start && d < range.endExclusive;
  const pickups: T[] = [];
  const dropoffs: T[] = [];

  for (const t of tasks) {
    if (t.noPickupRequired) continue;
    const pickup = new Date(t.pickupDate);
    const dropoff = new Date(t.dropoffDate);

    if (["PENDING", "CONFIRMED", "FLAGGED", "PICKED_UP", "READY_TO_RETURN"].includes(t.status) && inRange(pickup)) {
      pickups.push(t);
    }

    if (t.status === "PICKED_UP" || t.status === "READY_TO_RETURN") {
      if (dropoff < range.endExclusive) dropoffs.push(t);
    } else if (t.status === "DROPPED" && t.droppedAt && inRange(new Date(t.droppedAt))) {
      dropoffs.push(t);
    }
  }
  pickups.sort((a, b) => +new Date(a.pickupDate) - +new Date(b.pickupDate));
  dropoffs.sort((a, b) => +new Date(a.dropoffDate) - +new Date(b.dropoffDate));
  return { pickups, dropoffs };
}

/**
 * "Today" in the organisation's day (Australia/Sydney, as everywhere in the
 * laundry portal): the same window the Runs board's Today chip asks the feed
 * for when opened in Sydney (local midnight to the next midnight, 23 or 25
 * hours on daylight-saving days).
 */
export function todayRunsRange(now: Date = new Date()): RunRange {
  const today = sydneyTodayKey(now);
  return { start: sydneyDayStart(today), endExclusive: sydneyDayStart(addDaysToKey(today, 1)), days: 1 };
}

/** The distinct tasks of both loops, pickups first (a key-lost set in both appears once). */
export function runTasks<T extends { id: string }>(runs: { pickups: readonly T[]; dropoffs: readonly T[] }): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const task of [...runs.pickups, ...runs.dropoffs]) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    out.push(task);
  }
  return out;
}
