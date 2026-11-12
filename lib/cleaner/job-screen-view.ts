/**
 * Display helpers for the cleaner job screen header (approved board
 * "One job, four moments", 2026-11). Pure and plain. Times are Sydney wall
 * clock; a job date is its stored calendar day (never viewer-shifted).
 */

const TZ = "Australia/Sydney";

/** Sydney calendar day and minutes past midnight for an instant. */
export function sydneyWallClock(now: Date): { dateKey: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = Number(get("hour")) % 24;
  return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, minutes: hour * 60 + Number(get("minute")) };
}

/** The job's stored calendar day ("2026-11-12"), or null when unknown. */
export function jobDateKey(scheduledDate: string | Date | null | undefined): string | null {
  if (!scheduledDate) return null;
  const date = new Date(scheduledDate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * "2 h 12 m to guest arrival" on the day of the job, "Guest arrival time
 * passed" after it, null on any other day or when no arrival time is known.
 */
export function guestCountdownLabel(dateKey: string | null, deadline: string | null, now: Date): string | null {
  if (!dateKey || !deadline || !/^\d{2}:\d{2}$/.test(deadline)) return null;
  const wall = sydneyWallClock(now);
  if (wall.dateKey !== dateKey) return null;
  const [hours, minutes] = deadline.split(":").map(Number);
  const remaining = hours * 60 + minutes - wall.minutes;
  if (remaining <= 0) return "Guest arrival time passed";
  const h = Math.floor(remaining / 60);
  const m = remaining % 60;
  if (h === 0) return `${m} m to guest arrival`;
  return `${h} h ${m} m to guest arrival`;
}
