"use client";

/**
 * Robust client-side GPS capture shared by all cleaner flows (GPS check-in,
 * check-out, en-route pings, start/resume driving).
 *
 * Root cause of the "wrong location" complaints: one-shot
 * `getCurrentPosition` returns the FIRST available fix, which right after a
 * permission grant or on WiFi-only devices is usually a coarse IP / WiFi
 * triangulation fix (accuracy of 500m-5km). That coordinate was stored and
 * compared against the property without ever checking `coords.accuracy`.
 *
 * `getAccuratePosition` fixes that:
 *  1. One-shot high-accuracy `getCurrentPosition` (maximumAge: 0 — never a
 *     cached fix; timeout 15s).
 *  2. If the returned accuracy is worse than ACCEPTABLE_ACCURACY_M, open a
 *     short `watchPosition` window (up to 10s) and keep the best-accuracy
 *     fix seen, then clear the watch.
 *  3. Always resolve with `accuracy` so callers can show "±25 m" and warn
 *     when the fix is too coarse to trust.
 */

export interface GpsFix {
  lat: number;
  lng: number;
  /** Radius of 95% confidence in meters, or null when the device omits it. */
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  /** Epoch ms of the fix. */
  timestamp: number;
}

export type GpsErrorCode = "UNSUPPORTED" | "PERMISSION_DENIED" | "UNAVAILABLE" | "TIMEOUT";

export class GpsError extends Error {
  code: GpsErrorCode;
  constructor(code: GpsErrorCode, message: string) {
    super(message);
    this.name = "GpsError";
    this.code = code;
  }
}

/** A fix at or under this accuracy is accepted immediately. */
export const ACCEPTABLE_ACCURACY_M = 100;
/** Above this we still record, but the UI should flag the fix as unreliable. */
export const POOR_ACCURACY_M = 200;

const ONE_SHOT_TIMEOUT_MS = 15_000;
const REFINE_WINDOW_MS = 10_000;

function toFix(position: GeolocationPosition): GpsFix {
  const { coords } = position;
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
    heading: coords.heading != null && Number.isFinite(coords.heading) ? coords.heading : null,
    speed: coords.speed != null && Number.isFinite(coords.speed) ? coords.speed : null,
    timestamp: Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
  };
}

function mapGeolocationError(err: GeolocationPositionError): GpsError {
  if (err.code === err.PERMISSION_DENIED) {
    return new GpsError(
      "PERMISSION_DENIED",
      "Location access is blocked. Allow location for this site in your browser settings, then retry."
    );
  }
  if (err.code === err.TIMEOUT) {
    return new GpsError("TIMEOUT", "Could not get a GPS fix in time. Move somewhere with clearer sky and retry.");
  }
  return new GpsError("UNAVAILABLE", "Location is currently unavailable on this device.");
}

function oneShot(): Promise<GpsFix> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(toFix(pos)),
      (err) => reject(mapGeolocationError(err)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: ONE_SHOT_TIMEOUT_MS }
    );
  });
}

/** Watch for up to REFINE_WINDOW_MS, keeping the best-accuracy fix seen. */
function refineWithWatch(initial: GpsFix): Promise<GpsFix> {
  return new Promise((resolve) => {
    let best = initial;
    let settled = false;
    let watchId: number | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(timer);
      resolve(best);
    };

    const timer = window.setTimeout(finish, REFINE_WINDOW_MS);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = toFix(pos);
        const bestAcc = best.accuracy ?? Number.POSITIVE_INFINITY;
        const fixAcc = fix.accuracy ?? Number.POSITIVE_INFINITY;
        if (fixAcc < bestAcc) best = fix;
        if (fixAcc <= ACCEPTABLE_ACCURACY_M) finish();
      },
      () => {
        // Watch errors during refinement are non-fatal — keep the initial fix.
        finish();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: REFINE_WINDOW_MS }
    );
  });
}

/**
 * Resolve the most accurate position available within ~15-25s.
 * Rejects with a `GpsError` carrying a user-presentable message.
 */
export async function getAccuratePosition(): Promise<GpsFix> {
  if (typeof window === "undefined" || typeof navigator === "undefined" || !("geolocation" in navigator)) {
    throw new GpsError("UNSUPPORTED", "This device does not support location services.");
  }
  const first = await oneShot();
  if (first.accuracy != null && first.accuracy <= ACCEPTABLE_ACCURACY_M) {
    return first;
  }
  return refineWithWatch(first);
}

/** "±25 m" / "±1.2 km" label for a resolved accuracy. */
export function formatAccuracy(accuracy: number | null | undefined): string {
  if (accuracy == null || !Number.isFinite(accuracy)) return "accuracy unknown";
  if (accuracy >= 1000) return `±${(accuracy / 1000).toFixed(1)} km`;
  return `±${Math.round(accuracy)} m`;
}
