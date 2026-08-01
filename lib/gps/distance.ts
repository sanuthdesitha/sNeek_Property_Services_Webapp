/**
 * Pure geo utilities. Kept separate from `geofence.ts` (which imports the
 * server-only Prisma client) so unit tests and client-side code can use these
 * functions without pulling in a Node runtime dependency.
 */

const EARTH_RADIUS_M = 6_371_000;

export const DEFAULT_GEOFENCE_RADIUS_M = 75;

/**
 * How far from the property still counts as "on site" AT CHECK-IN.
 *
 * Deliberately wider than the 75 m passive geofence, and for a different job.
 * The geofence answers "has this phone left the property?" from a stream of
 * pings, where a tight radius plus a 3-ping/2-minute debounce filters noise.
 * This answers "is this person actually here?" from ONE fix taken at the moment
 * of arrival — often indoors, in a stairwell, or in a basement carpark, where a
 * 75 m radius produces false "off-site" prompts for someone standing in the
 * kitchen. 150 m tolerates apartment blocks and poor urban fixes while still
 * catching the case this exists for: starting the job from somewhere else
 * entirely.
 */
export const ON_SITE_RADIUS_M = 150;

/**
 * A fix this coarse cannot prove anything either way. Above it, we neither
 * trust an "on site" result nor accuse anyone of being off site — we ask them
 * to confirm instead.
 */
export const UNRELIABLE_ACCURACY_M = 200;

/** Per-property override, falling back to the default check-in radius. */
export function resolveOnSiteRadius(radiusM?: number | null): number {
  return typeof radiusM === "number" && radiusM > 0 ? radiusM : ON_SITE_RADIUS_M;
}

export type OnSiteVerdict = "ON_SITE" | "OFF_SITE" | "UNRELIABLE";

/**
 * Classify a check-in fix. Kept pure and separate from the route so the
 * threshold behaviour is unit-testable without a database.
 */
export function classifyCheckInLocation(input: {
  distanceM: number | null | undefined;
  accuracyM?: number | null;
  radiusM?: number | null;
}): OnSiteVerdict {
  if (input.distanceM == null || !Number.isFinite(input.distanceM)) return "UNRELIABLE";
  // A ±3 km fix that happens to land inside the radius is not evidence of
  // presence, and one that lands outside is not evidence of absence.
  if (input.accuracyM != null && input.accuracyM > UNRELIABLE_ACCURACY_M) return "UNRELIABLE";
  return input.distanceM <= resolveOnSiteRadius(input.radiusM) ? "ON_SITE" : "OFF_SITE";
}

/** Great-circle distance in meters between two lat/lng points. */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}
