/**
 * Expected-finish-time heuristic for the cleaner daily briefing.
 *
 * Pure + deterministic — no I/O. Given the day's ordered stops (estimated
 * hours + property coordinates) it simulates a straight run:
 *
 *   finish = start
 *          + Σ estimatedHours (per stop)
 *          + Σ travel legs between consecutive properties
 *              (haversine ÷ speed)
 *          + 10 min buffer per stop
 *
 * When the first stop has no startTime we fall back to a default assumed start
 * and flag it, so the UI can phrase it "if you start at 8:00 am".
 */
import { haversine } from "@/lib/gps/distance";

/** Default clock start when the first job carries no startTime (minutes past midnight). */
const DEFAULT_START_MIN = 8 * 60; // 08:00
const DEFAULT_JOB_HOURS = 2; // used when estimatedHours is missing
const STOP_BUFFER_MIN = 10; // per-stop setup/pack-down buffer
const URBAN_SPEED_KMH = 30; // default urban driving speed
const TRANSIT_SPEED_KMH = 18; // slower speed when travelling by transit

export interface FinishTimeStop {
  startTime: string | null; // HH:mm
  estimatedHours: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface FinishTimeResult {
  startMinutes: number;
  finishMinutes: number;
  totalHours: number; // work + travel + buffers, in hours
  assumedStart: boolean;
  travelMethod: "driving" | "transit";
}

function parseHHmm(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Simulate the day's run.
 *
 * @param stops   Ordered stops (schedule order).
 * @param method  Cleaner travel method — "transit" uses a slower leg speed.
 */
export function computeFinishTime(
  stops: FinishTimeStop[],
  method: "driving" | "transit" = "driving"
): FinishTimeResult | null {
  if (!Array.isArray(stops) || stops.length === 0) return null;

  const firstStart = parseHHmm(stops[0]?.startTime);
  const startMinutes = firstStart ?? DEFAULT_START_MIN;
  const speedKmh = method === "transit" ? TRANSIT_SPEED_KMH : URBAN_SPEED_KMH;

  let cursor = startMinutes;
  let prev: FinishTimeStop | null = null;

  for (const stop of stops) {
    // Travel leg from the previous property (skip for the first stop).
    if (
      prev &&
      typeof prev.latitude === "number" &&
      typeof prev.longitude === "number" &&
      typeof stop.latitude === "number" &&
      typeof stop.longitude === "number"
    ) {
      const metres = haversine(prev.latitude, prev.longitude, stop.latitude, stop.longitude);
      const km = metres / 1000;
      const legMin = (km / speedKmh) * 60;
      cursor += legMin;
    } else if (prev) {
      // Unknown coordinates → assume a modest 15-minute hop between stops.
      cursor += 15;
    }

    const hours =
      typeof stop.estimatedHours === "number" && Number.isFinite(stop.estimatedHours) && stop.estimatedHours > 0
        ? stop.estimatedHours
        : DEFAULT_JOB_HOURS;
    cursor += hours * 60;
    cursor += STOP_BUFFER_MIN;
    prev = stop;
  }

  const totalHours = Number(((cursor - startMinutes) / 60).toFixed(2));

  return {
    startMinutes,
    finishMinutes: Math.round(cursor),
    totalHours,
    assumedStart: firstStart == null,
    travelMethod: method,
  };
}

/** Format minutes-past-midnight as a friendly 12-hour clock, e.g. "4:45 pm". */
export function formatClock(minutes: number): string {
  let m = Math.round(minutes) % (24 * 60);
  if (m < 0) m += 24 * 60;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 >= 12 ? "pm" : "am";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}
