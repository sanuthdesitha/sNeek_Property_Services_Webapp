/**
 * Pure decisions of the location tracker (lib/gps/client.tsx), unit-tested
 * without a browser: when a fix is worth queueing, what a flush response means
 * for the queued batch, what to tell the office about the phone's state, and
 * when to restart the position watch.
 */
import type { TrackingState } from "./staleness";

/** A fix is queued only after this long or this far since the last one. */
export const MIN_FIX_INTERVAL_MS = 20_000;
export const MIN_FIX_DISTANCE_M = 50;
/** Ask for a fresh fix when nothing was queued for this long (a still phone). */
export const HEARTBEAT_INTERVAL_MS = 45_000;
/** Send the queue this often while the page runs. */
export const FLUSH_INTERVAL_MS = 30_000;
/** No fix for this long while visible: restart the watch. */
export const WATCH_STALL_MS = 2 * 60_000;
/** The server's batch limit (lib/gps/ingest MAX_BATCH). */
export const MAX_BATCH = 50;

/** Metres between two coordinates (small-angle; plenty for a 50 m threshold). */
export function roughDistanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2));
  const y = toRad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

export function shouldQueueFix(
  previous: { lat: number; lng: number; queuedAt: number } | null,
  next: { lat: number; lng: number },
  now: number,
): boolean {
  if (!previous) return true;
  return now - previous.queuedAt >= MIN_FIX_INTERVAL_MS || roughDistanceM(previous, next) >= MIN_FIX_DISTANCE_M;
}

export type FlushVerdict =
  /** Stored or refused for good: remove the batch, continue with the next. */
  | { kind: "clear"; windowClosed: boolean; arrivedStop: { taskId: string; kind: string } | null }
  /** Keep the batch and stop this flush (auth, rate limit, server error). */
  | { kind: "retain"; retryAfterMs: number | null };

/** What one flush response means for the batch that was sent. */
export function interpretFlushResponse(status: number, body: unknown): FlushVerdict {
  if (status >= 200 && status < 300) {
    const value = (body && typeof body === "object" ? body : {}) as { window?: { active?: unknown }; arrivedStop?: { taskId?: unknown; kind?: unknown } };
    const arrived = value.arrivedStop && typeof value.arrivedStop.taskId === "string" && typeof value.arrivedStop.kind === "string"
      ? { taskId: value.arrivedStop.taskId, kind: value.arrivedStop.kind }
      : null;
    return { kind: "clear", windowClosed: value.window?.active === false, arrivedStop: arrived };
  }
  // Only a request the server can never accept is dropped.
  if (status === 400 || status === 422) return { kind: "clear", windowClosed: false, arrivedStop: null };
  if (status === 429) {
    const retry = body && typeof body === "object" ? (body as { retryAfterMs?: unknown }).retryAfterMs : null;
    return { kind: "retain", retryAfterMs: typeof retry === "number" && retry > 0 ? retry : null };
  }
  return { kind: "retain", retryAfterMs: null };
}

export type PhoneConditions = {
  permission: "prompt" | "granted" | "denied";
  visible: boolean;
  online: boolean;
  /** Consecutive position errors other than a denial (no fix available). */
  unavailable: boolean;
};

/** What the office should be told about this phone right now. */
export function trackingStateFor(conditions: PhoneConditions): TrackingState {
  if (conditions.permission === "denied") return "PERMISSION_OFF";
  if (!conditions.online) return "OFFLINE";
  if (!conditions.visible) return "BACKGROUND";
  if (conditions.unavailable) return "UNAVAILABLE";
  return "SHARING";
}

/** Restart the watch when the page is visible and the watch has gone quiet or died. */
export function shouldRestartWatch(input: { visible: boolean; watchAlive: boolean; lastFixAt: number | null; now: number; permission: "prompt" | "granted" | "denied" }): boolean {
  if (!input.visible || input.permission === "denied") return false;
  if (!input.watchAlive) return true;
  return input.lastFixAt != null && input.now - input.lastFixAt > WATCH_STALL_MS;
}

/** A unique id for a queued fix; the server stores a retried batch once. */
export function newClientPingId(now: number, random: () => number = Math.random): string {
  return `${now.toString(36)}-${random().toString(36).slice(2, 10)}`;
}
