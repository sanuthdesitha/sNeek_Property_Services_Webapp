/**
 * One geofence policy for every passive location judgement: the ping
 * pipeline's arrival/departure checks, the Live ops status, the live board's
 * "off site with the clock running" and the job page badge. Pure and
 * client-safe.
 *
 * - Radius: the property's own `geofenceRadiusM` when set (large complexes,
 *   underground parking), else the 75 m default.
 * - Accuracy: a fix coarser than the departure threshold (60 m) cannot say
 *   inside or outside; it is UNKNOWN, never "off site".
 * - Hysteresis: OUTSIDE needs the fix beyond radius + 25 m; between the radius
 *   and that band the answer is UNKNOWN, so a fix wobbling on the boundary does
 *   not flip the person in and out.
 *
 * The thresholds come from lib/gps/departure and lib/gps/distance unchanged.
 */
import { DEFAULT_GEOFENCE_RADIUS_M, haversine } from "./distance";
import { DEPARTURE_HYSTERESIS_M, DEPARTURE_MAX_ACCURACY_M } from "./departure";

export type FenceVerdict = "INSIDE" | "OUTSIDE" | "UNKNOWN";

/** The passive geofence radius for a property. */
export function passiveGeofenceRadius(propertyRadiusM?: number | null): number {
  return typeof propertyRadiusM === "number" && Number.isFinite(propertyRadiusM) && propertyRadiusM > 0
    ? propertyRadiusM
    : DEFAULT_GEOFENCE_RADIUS_M;
}

/** A fix precise enough to judge inside/outside (null accuracy counts, as in departure). */
export function isAccurateFix(accuracyM: number | null | undefined): boolean {
  return accuracyM == null || (Number.isFinite(accuracyM) && accuracyM <= DEPARTURE_MAX_ACCURACY_M);
}

export function fenceVerdict(input: {
  distanceM: number | null | undefined;
  accuracyM?: number | null;
  radiusM: number;
}): FenceVerdict {
  if (input.distanceM == null || !Number.isFinite(input.distanceM)) return "UNKNOWN";
  if (!isAccurateFix(input.accuracyM)) return "UNKNOWN";
  if (input.distanceM <= input.radiusM) return "INSIDE";
  if (input.distanceM > input.radiusM + DEPARTURE_HYSTERESIS_M) return "OUTSIDE";
  return "UNKNOWN";
}

export type FenceJudgement = { verdict: FenceVerdict; distanceM: number | null; radiusM: number };

/** Judge a fix against a property (null coordinates on either side: UNKNOWN). */
export function judgeFix(
  fix: { lat: number; lng: number; accuracy?: number | null } | null,
  property: { latitude?: number | null; longitude?: number | null; geofenceRadiusM?: number | null } | null | undefined,
): FenceJudgement {
  const radiusM = passiveGeofenceRadius(property?.geofenceRadiusM);
  if (!fix || property?.latitude == null || property?.longitude == null) {
    return { verdict: "UNKNOWN", distanceM: null, radiusM };
  }
  const distanceM = haversine(fix.lat, fix.lng, property.latitude, property.longitude);
  return { verdict: fenceVerdict({ distanceM, accuracyM: fix.accuracy ?? null, radiusM }), distanceM, radiusM };
}

/** The live-status `insideGeofence` input: true, false or unknown (null). */
export function insideFromVerdict(verdict: FenceVerdict): boolean | null {
  return verdict === "INSIDE" ? true : verdict === "OUTSIDE" ? false : null;
}
