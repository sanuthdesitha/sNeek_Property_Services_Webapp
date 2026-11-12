/**
 * The location recorded at the start of ONE cleaner's clock segment, and the
 * off-site gate evaluated for it. Pure (unit-tested); used by
 * POST /api/cleaner/jobs/[id]/start for every start and resume.
 *
 * Same rule as the job-level arrival check-in (lib/gps/distance
 * classifyCheckInLocation: 150 m or the property's radius; a fix coarser than
 * 200 m judges nothing), and the same coded reasons (lib/gps/off-site-reasons).
 * A tag tapped by this cleaner on this job stands in for a fix: it proves they
 * were at the door, and the gate is not run against a fix they did not need.
 */
import { z } from "zod";
import { classifyCheckInLocation, haversine, resolveOnSiteRadius } from "./distance";
import { OFF_SITE_REASON_CODES, isValidOffSiteReason } from "./off-site-reasons";

export const startLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional().nullable(),
  reasonCode: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});

export type StartLocationInput = z.infer<typeof startLocationSchema>;

export type StartLocationColumns = {
  startLat: number | null;
  startLng: number | null;
  startAccuracyM: number | null;
  startDistanceM: number | null;
  startVerdict: "ON_SITE" | "OFF_SITE" | "UNRELIABLE" | "NO_GEOFENCE" | null;
  startReasonCode: string | null;
  startNote: string | null;
  startLocationSource: "GPS" | "NFC";
};

export type StartLocationRecord = {
  columns: StartLocationColumns;
  /** The fix to seed the live position with (null for a tag-only start). */
  fix: { lat: number; lng: number; accuracy: number | null } | null;
};

export type StartLocationDecision =
  | { ok: true; record: StartLocationRecord }
  | { ok: false; body: Record<string, unknown> };

export function evaluateStartLocation(input: {
  location: StartLocationInput | null;
  property: { name?: string | null; latitude?: number | null; longitude?: number | null; geofenceRadiusM?: number | null } | null;
  tagTapped: boolean;
}): StartLocationDecision {
  const { location, property } = input;
  if (!location) {
    if (input.tagTapped) {
      return {
        ok: true,
        record: {
          fix: null,
          columns: {
            startLat: null, startLng: null, startAccuracyM: null, startDistanceM: null, startVerdict: null,
            startReasonCode: null, startNote: null, startLocationSource: "NFC",
          },
        },
      };
    }
    return {
      ok: false,
      body: {
        error: "LOCATION_REQUIRED",
        message: "Turn on location for this app to start your clock. The office sees your location until you clock out.",
      },
    };
  }

  const hasGeofence = property?.latitude != null && property?.longitude != null;
  const distanceM = hasGeofence ? haversine(location.lat, location.lng, property!.latitude!, property!.longitude!) : null;
  const verdict = hasGeofence
    ? classifyCheckInLocation({ distanceM, accuracyM: location.accuracy ?? null, radiusM: property?.geofenceRadiusM ?? null })
    : "NO_GEOFENCE";
  const reasonCode = location.reasonCode?.trim() || null;
  if (verdict === "OFF_SITE" && !input.tagTapped && !isValidOffSiteReason(reasonCode)) {
    return {
      ok: false,
      body: {
        error: "OFF_SITE_REASON_REQUIRED",
        message: `You're about ${Math.round(distanceM ?? 0)} m from ${property?.name ?? "the property"}. Tell us why you're starting from here.`,
        distanceMeters: distanceM == null ? null : Math.round(distanceM),
        radiusM: resolveOnSiteRadius(property?.geofenceRadiusM ?? null),
        reasons: OFF_SITE_REASON_CODES,
      },
    };
  }
  return {
    ok: true,
    record: {
      fix: { lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null },
      columns: {
        startLat: location.lat,
        startLng: location.lng,
        startAccuracyM: location.accuracy ?? null,
        startDistanceM: distanceM == null ? null : Math.round(distanceM),
        startVerdict: verdict,
        startReasonCode: verdict === "OFF_SITE" ? reasonCode : null,
        startNote: verdict === "OFF_SITE" ? location.note?.trim() || null : null,
        startLocationSource: "GPS",
      },
    },
  };
}
