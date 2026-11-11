/**
 * Pure ordering for the computed Jobs sorts (Guest in, Charge). No database:
 * `list-computed-sort.ts` loads the rows, these functions order them.
 *
 * - A row with no value (no arriving guest, no rate) always sorts LAST,
 *   whichever direction is asked for.
 * - Equal values fall back to the scheduled day, then the job id, so the order
 *   is stable and paging never repeats or skips a row.
 */
import { sydneyDayStart } from "@/lib/time/sydney-range";
import type { JobGuestIn } from "./list-row-extras";

export type ComputedSortRow = {
  id: string;
  /** Scheduled day (UTC date key as epoch ms): the tie-break. */
  dayMs: number;
  /** The sort value, or null when there is none. */
  value: number | null;
};

/**
 * Guest in as a number: the check-in instant when the booking gave one, else
 * the start of the arriving stay's Sydney day (the column then shows the
 * date), else null.
 */
export function guestInSortValue(guest: Pick<JobGuestIn, "checkinAt" | "stayStartDate">): number | null {
  if (guest.checkinAt) {
    const instant = Date.parse(guest.checkinAt);
    if (Number.isFinite(instant)) return instant;
  }
  if (guest.stayStartDate && /^\d{4}-\d{2}-\d{2}$/.test(guest.stayStartDate)) {
    const day = sydneyDayStart(guest.stayStartDate).getTime();
    if (Number.isFinite(day)) return day;
  }
  return null;
}

export function compareComputedRows(a: ComputedSortRow, b: ComputedSortRow, dir: "asc" | "desc"): number {
  if (a.value === null && b.value !== null) return 1;
  if (b.value === null && a.value !== null) return -1;
  if (a.value !== null && b.value !== null && a.value !== b.value) {
    return dir === "asc" ? a.value - b.value : b.value - a.value;
  }
  if (a.dayMs !== b.dayMs) return a.dayMs - b.dayMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
