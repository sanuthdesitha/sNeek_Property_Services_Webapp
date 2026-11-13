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

/**
 * The device's error when no fix could be had after the normal attempt.
 * PERMISSION_DENIED is NOT here: a refused permission refuses the start
 * (live location is mandatory); only a phone that is allowed but cannot get a
 * position (indoors, weak GPS, timeout, fault) may start with a reason.
 */
export const NO_FIX_ERRORS = ["TIMEOUT", "UNAVAILABLE", "UNSUPPORTED"] as const;
export type NoFixError = (typeof NO_FIX_ERRORS)[number];

/** A short reason the person gives for starting without a fix. */
export const noFixSchema = z.object({
  reason: z.string().trim().min(3, "Say why there is no location.").max(200),
  error: z.enum(NO_FIX_ERRORS),
});
export type NoFixInput = z.infer<typeof noFixSchema>;

const fixSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional().nullable(),
  reasonCode: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});

export const startLocationSchema = z.union([fixSchema, z.object({ noFix: noFixSchema })]);

export type StartLocationFixInput = z.infer<typeof fixSchema>;
export type StartLocationInput = z.infer<typeof startLocationSchema>;

/** Office wording for a no-fix start (job page, Live ops, notices). */
export const NO_FIX_LABEL = "Started without a location fix";

export function noFixErrorLabel(error: string | null | undefined): string {
  switch (error) {
    case "TIMEOUT":
      return "the phone timed out looking for a position";
    case "UNAVAILABLE":
      return "the phone reported no position available";
    case "UNSUPPORTED":
      return "the device has no location service";
    default:
      return "no position from the device";
  }
}

export type StartLocationColumns = {
  startLat: number | null;
  startLng: number | null;
  startAccuracyM: number | null;
  startDistanceM: number | null;
  startVerdict: "ON_SITE" | "OFF_SITE" | "UNRELIABLE" | "NO_GEOFENCE" | "NO_FIX" | null;
  startReasonCode: string | null;
  startNote: string | null;
  startLocationSource: "GPS" | "NFC" | "NO_FIX";
  startLocationAt?: Date | null;
};

export type StartLocationRecord = {
  columns: StartLocationColumns;
  /** Started without a fix: tell the office (inbox) so they can follow up. */
  noFix?: NoFixInput;
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
  now?: Date;
}): StartLocationDecision {
  const { property } = input;
  // Allowed, notice accepted, but no position after the normal attempt:
  // start with the person's reason. Judged neither on site nor off site; the
  // tracker's first later fix becomes a LATE start location.
  if (input.location && "noFix" in input.location) {
    const noFix = input.location.noFix;
    return {
      ok: true,
      record: {
        fix: null,
        noFix,
        columns: {
          startLat: null, startLng: null, startAccuracyM: null, startDistanceM: null,
          startVerdict: "NO_FIX", startReasonCode: noFix.error, startNote: noFix.reason,
          startLocationSource: "NO_FIX", startLocationAt: null,
        },
      },
    };
  }
  const location: StartLocationFixInput | null = input.location;
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
        startLocationAt: input.now ?? new Date(),
      },
    },
  };
}
