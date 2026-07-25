/**
 * Pure departure evaluation — decides whether a cleaner has GENUINELY left a
 * job site, as opposed to a single GPS drift spike. Kept free of Prisma /
 * server imports so it can be unit-tested and shared.
 *
 * A departure is confirmed only when:
 *  - the 3 most recent ACCURATE pings are ALL outside the geofence radius plus
 *    a 25m hysteresis band (>100m for the default 75m fence), AND
 *  - the run spans real time: the oldest of those 3 pings is >= 2 minutes
 *    before the newest.
 *
 * "Accurate" means reported accuracy <= 60m. Pings with NULL accuracy count as
 * accurate: most browser Geolocation implementations always report accuracy,
 * so a missing value usually means an older client build — treating it as
 * inaccurate would permanently disable departure detection for those devices.
 *
 * Absence of pings NEVER confirms departure (a dead phone is not a departure).
 */

import { haversine, DEFAULT_GEOFENCE_RADIUS_M } from "./distance";

/** Extra distance beyond the fence radius a ping must be to count as "outside". */
export const DEPARTURE_HYSTERESIS_M = 25;
/** Pings with worse (larger) reported accuracy than this are ignored. */
export const DEPARTURE_MAX_ACCURACY_M = 60;
/** How many consecutive accurate outside pings are required. */
export const DEPARTURE_CONFIRM_PINGS = 3;
/** Minimum time span (oldest→newest of the confirming run). */
export const DEPARTURE_MIN_SPAN_MS = 2 * 60_000;

export interface DeparturePing {
  lat: number;
  lng: number;
  /** Reported GPS accuracy in meters. Null/undefined counts as accurate. */
  accuracy?: number | null;
  timestamp: Date;
}

export interface EvaluateDepartureInput {
  /** Recent pings, NEWEST FIRST (caller supplies the last ~10 for the job/user). */
  pings: DeparturePing[];
  radiusM?: number;
  propertyLat: number;
  propertyLng: number;
  now?: Date;
}

export interface EvaluateDepartureResult {
  confirmedDeparted: boolean;
  /** Timestamp of the first (oldest) ping of the confirming outside-run. */
  departedAt?: Date;
}

/** True when the point sits within the geofence radius of the property. */
export function isInsideGeofence(
  lat: number,
  lng: number,
  propertyLat: number,
  propertyLng: number,
  radiusM: number = DEFAULT_GEOFENCE_RADIUS_M,
): boolean {
  return haversine(lat, lng, propertyLat, propertyLng) <= radiusM;
}

export function evaluateDeparture(input: EvaluateDepartureInput): EvaluateDepartureResult {
  const radius = input.radiusM ?? DEFAULT_GEOFENCE_RADIUS_M;
  const outsideThreshold = radius + DEPARTURE_HYSTERESIS_M;

  // Only accurate fixes participate in the decision — a 500m-accuracy cell
  // fix must be able to neither confirm nor veto a departure.
  const accurate = input.pings.filter(
    (p) => p.accuracy == null || p.accuracy <= DEPARTURE_MAX_ACCURACY_M,
  );

  if (accurate.length < DEPARTURE_CONFIRM_PINGS) return { confirmedDeparted: false };

  // The 3 most recent accurate pings (input is newest-first).
  const run = accurate.slice(0, DEPARTURE_CONFIRM_PINGS);

  const allOutside = run.every(
    (p) => haversine(p.lat, p.lng, input.propertyLat, input.propertyLng) > outsideThreshold,
  );
  if (!allOutside) return { confirmedDeparted: false };

  const newest = run[0].timestamp.getTime();
  const oldest = run[run.length - 1].timestamp.getTime();
  if (newest - oldest < DEPARTURE_MIN_SPAN_MS) return { confirmedDeparted: false };

  // departedAt = start of the confirming outside-run: walk back through any
  // OLDER accurate pings that are also outside, so a longer continuous run
  // stamps the moment they actually crossed out, not just 3 pings ago.
  let departedAt = run[run.length - 1].timestamp;
  for (let i = DEPARTURE_CONFIRM_PINGS; i < accurate.length; i++) {
    const p = accurate[i];
    if (haversine(p.lat, p.lng, input.propertyLat, input.propertyLng) > outsideThreshold) {
      departedAt = p.timestamp;
    } else {
      break;
    }
  }

  return { confirmedDeparted: true, departedAt };
}
