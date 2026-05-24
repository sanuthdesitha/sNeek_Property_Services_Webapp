/**
 * Pure geo utilities. Kept separate from `geofence.ts` (which imports the
 * server-only Prisma client) so unit tests and client-side code can use these
 * functions without pulling in a Node runtime dependency.
 */

const EARTH_RADIUS_M = 6_371_000;

export const DEFAULT_GEOFENCE_RADIUS_M = 75;

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
