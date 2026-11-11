/**
 * Time changes for a calendar move. PURE: no clock, no database.
 *
 * Two ways ask for a new start time:
 * - a drop on the Day view's hour track: the pointer position, less where the
 *   chip was grabbed, snapped to `TIME_DROP_STEP_MINUTES`;
 * - Jobs bulk Reschedule: a whole-minute shift of each job's own start.
 *
 * Either way the job keeps its length: the due time moves by the same amount.
 * The result is only a PROPOSAL for the server's move check; the reschedule
 * service (`applyReschedule`) still validates the window and writes it. That
 * service sets `startTime` and `dueTime` only, so a job with a separate end
 * time is refused here (its end time would be left behind) and is changed on
 * its Schedule tab instead.
 */
export const TIME_DROP_STEP_MINUTES = 15;
export const MAX_SHIFT_MINUTES = 12 * 60;
const DAY_MINUTES = 24 * 60;

export function parseHm(value: string | null | undefined): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatHm(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function snapToStep(minutes: number, step: number = TIME_DROP_STEP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/**
 * The start a Day-view drop proposes: pointer minute on the track less the
 * grab offset, snapped, and kept inside the day. Null when the track position
 * is unknown.
 */
export function proposedDropStart(input: { pointerMinute: number | null; grabOffsetMinutes: number }): string | null {
  if (input.pointerMinute === null || !Number.isFinite(input.pointerMinute)) return null;
  const snapped = snapToStep(input.pointerMinute - input.grabOffsetMinutes);
  return formatHm(Math.min(Math.max(snapped, 0), DAY_MINUTES - TIME_DROP_STEP_MINUTES));
}

/** Minute of the day under a pointer on an hour track. */
export function trackMinute(offsetPx: number, axisStartMinute: number, pxPerHour: number): number | null {
  if (!Number.isFinite(offsetPx) || !(pxPerHour > 0)) return null;
  return axisStartMinute + (offsetPx / pxPerHour) * 60;
}

export type TimeChangeRequest = { toStartTime?: string | null; shiftMinutes?: number | null };
export type TimedJob = { startTime: string | null; dueTime: string | null; endTime: string | null };

export type TimeChange =
  | { kind: "none" }
  | { kind: "refused"; reason: string }
  | { kind: "change"; startTime: string; dueTime: string | null };

export function plannedTimeChange(job: TimedJob, request: TimeChangeRequest): TimeChange {
  const shift = request.shiftMinutes ?? 0;
  const wantsStart = typeof request.toStartTime === "string";
  if (!wantsStart && shift === 0) return { kind: "none" };
  const start = parseHm(job.startTime);
  let target: number;
  if (wantsStart) {
    const requested = parseHm(request.toStartTime);
    if (requested === null) return { kind: "refused", reason: "Choose a start time written as HH:mm." };
    target = requested;
  } else {
    if (!Number.isInteger(shift) || Math.abs(shift) > MAX_SHIFT_MINUTES) {
      return { kind: "refused", reason: `A time shift must be whole minutes, at most ${MAX_SHIFT_MINUTES / 60} hours either way.` };
    }
    if (start === null) return { kind: "refused", reason: "This job has no start time to shift. Set its times on the Schedule tab." };
    target = start + shift;
  }
  if (start !== null && target === start) return { kind: "none" };
  if (job.endTime) {
    return { kind: "refused", reason: `This job has a separate end time (${job.endTime}) that a calendar move cannot change. Change its times on the job's Schedule tab.` };
  }
  if (target < 0 || target >= DAY_MINUTES) return { kind: "refused", reason: "The new start would fall on another day. Move the date instead." };
  const due = parseHm(job.dueTime);
  if (due === null) return { kind: "change", startTime: formatHm(target), dueTime: job.dueTime };
  if (start === null) return { kind: "refused", reason: "This job has a due time but no start time. Set its times on the Schedule tab." };
  const newDue = due + (target - start);
  if (newDue >= DAY_MINUTES || newDue < 0) return { kind: "refused", reason: "Keeping the job's length, it would finish after midnight. Choose an earlier start." };
  return { kind: "change", startTime: formatHm(target), dueTime: formatHm(newDue) };
}
