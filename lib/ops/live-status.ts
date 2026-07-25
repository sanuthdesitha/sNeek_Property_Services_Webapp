/**
 * Truthful live-status derivation for the ops map / live-cleaner surfaces.
 *
 * Pure — no Prisma, no server imports — so the API route, the admin dashboard
 * and both client components can share ONE definition of "on site". The old
 * derivation called anyone with an open timer (or any active job) ON_SITE even
 * when their GPS said otherwise; this module only says ON_SITE when the timer,
 * ping freshness and geofence all agree.
 */

export const LIVE_STALE_AFTER_MS = 3 * 60_000;

export type LiveStatusCode =
  | "ON_SITE"
  | "OFF_SITE"
  | "NO_SIGNAL"
  | "PAUSED"
  | "LEFT_SITE"
  | "EN_ROUTE"
  | "IDLE";

export interface DeriveLiveStatusInput {
  hasOpenTimer: boolean;
  /** Active job's status (Prisma JobStatus as string), null when none. */
  jobStatus: string | null;
  lastPingAt: Date | null;
  /** Latest ping inside the fence? null when unknown (no ping / no coords). */
  insideGeofence: boolean | null;
  departedAt: Date | null;
  now: Date;
  /** Property has usable coordinates (a geofence exists to judge against). */
  hasGeofence: boolean;
}

export interface LiveStatusResult {
  status: LiveStatusCode;
  label: string;
}

/**
 * Human relative-age string ("just now", "4 min ago", "2 hrs ago").
 * Shared by the server derivation and the client components so labels match.
 */
export function formatRelativeAgo(
  at: Date | string | null | undefined,
  now: Date | number = Date.now(),
): string {
  if (at == null) return "no GPS yet";
  const ms = typeof at === "string" ? new Date(at).getTime() : at.getTime();
  if (!Number.isFinite(ms)) return "no GPS yet";
  const nowMs = typeof now === "number" ? now : now.getTime();
  const minutes = Math.floor((nowMs - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
}

export function deriveLiveStatus(input: DeriveLiveStatusInput): LiveStatusResult {
  const { now } = input;
  const pingAgeMs = input.lastPingAt ? now.getTime() - input.lastPingAt.getTime() : null;
  const freshPing = pingAgeMs != null && pingAgeMs <= LIVE_STALE_AFTER_MS;

  // ── Open timer (clocked in) ─────────────────────────────────────────────
  if (input.hasOpenTimer) {
    if (freshPing) {
      if (!input.hasGeofence) {
        // No property coords to judge against — trust the timer + fresh ping.
        return { status: "ON_SITE", label: "On job (no geofence)" };
      }
      if (input.insideGeofence === true) {
        return { status: "ON_SITE", label: "On site" };
      }
      return { status: "OFF_SITE", label: "Clocked in · off site" };
    }
    return {
      status: "NO_SIGNAL",
      label: `Clocked in · no signal ${formatRelativeAgo(input.lastPingAt, now)}`,
    };
  }

  // ── No timer ────────────────────────────────────────────────────────────
  if (input.jobStatus === "PAUSED") {
    return {
      status: "PAUSED",
      label: input.departedAt
        ? `Left site ${formatRelativeAgo(input.departedAt, now)}`
        : `Paused · last seen ${formatRelativeAgo(input.lastPingAt, now)}`,
    };
  }

  if (input.departedAt) {
    return { status: "LEFT_SITE", label: `Left site ${formatRelativeAgo(input.departedAt, now)}` };
  }

  if (input.jobStatus === "EN_ROUTE") {
    return { status: "EN_ROUTE", label: "En route" };
  }

  return { status: "IDLE", label: "Idle" };
}
