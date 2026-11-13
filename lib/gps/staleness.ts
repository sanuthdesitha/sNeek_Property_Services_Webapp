/**
 * One staleness policy for every live-location surface (Live ops list and
 * map, the office laundry driver map, the live board). Client-safe: no
 * server imports.
 *
 * The age is always measured from when the fix was TAKEN (clock-corrected on
 * ingest), never from when it reached the server: a backlog that arrives late
 * is history, not a live position.
 */

/** A fix this recent is shown as live. */
export const LOCATION_LIVE_MS = 3 * 60_000;
/** Older than live but younger than this: "aging". Beyond: stale. */
export const LOCATION_AGING_MS = 10 * 60_000;
/** A fix less precise than this is drawn as approximate (ring, hollow fill). */
export const APPROXIMATE_ACCURACY_M = 100;

export type LocationFreshness = "live" | "aging" | "stale" | "none";

export type FreshnessTier = {
  key: Exclude<LocationFreshness, "none">;
  maxMs: number;
  color: string;
  label: string;
};

export const FRESHNESS_TIERS: readonly FreshnessTier[] = [
  { key: "live", maxMs: LOCATION_LIVE_MS, color: "#3f9b6d", label: "Live (< 3 min)" },
  { key: "aging", maxMs: LOCATION_AGING_MS, color: "#c99a2e", label: "Aging (< 10 min)" },
  { key: "stale", maxMs: Number.POSITIVE_INFINITY, color: "#b4472e", label: "Stale (10 min +)" },
];

function toMs(value: string | number | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Freshness of a fix measured at `measuredAt`, judged at `now`. */
export function locationFreshness(measuredAt: string | number | Date | null | undefined, now: number = Date.now()): LocationFreshness {
  const at = toMs(measuredAt);
  if (at == null) return "none";
  const age = Math.max(0, now - at);
  if (age <= LOCATION_LIVE_MS) return "live";
  if (age <= LOCATION_AGING_MS) return "aging";
  return "stale";
}

/** The colour tier for a fix; a missing fix uses the stale tier. */
export function freshnessTier(measuredAt: string | number | Date | null | undefined, now: number = Date.now()): FreshnessTier {
  const freshness = locationFreshness(measuredAt, now);
  return FRESHNESS_TIERS.find((tier) => tier.key === freshness) ?? FRESHNESS_TIERS[FRESHNESS_TIERS.length - 1];
}

/** True when a fix exists and is coarser than the approximate threshold. */
export function isApproximateFix(accuracyM: number | null | undefined): boolean {
  return typeof accuracyM === "number" && Number.isFinite(accuracyM) && accuracyM > APPROXIMATE_ACCURACY_M;
}

/** What the phone last told the server about its own tracking. */
export const TRACKING_STATES = ["SHARING", "BACKGROUND", "PERMISSION_OFF", "OFFLINE", "UNAVAILABLE"] as const;
export type TrackingState = (typeof TRACKING_STATES)[number];

export function isTrackingState(value: unknown): value is TrackingState {
  return typeof value === "string" && (TRACKING_STATES as readonly string[]).includes(value);
}

/** Office wording for a reported tracking state (null when it is sharing). */
export function trackingStateLabel(state: string | null | undefined): string | null {
  switch (state) {
    case "BACKGROUND":
      return "App in the background";
    case "PERMISSION_OFF":
      return "Location permission off";
    case "OFFLINE":
      return "Phone offline";
    case "UNAVAILABLE":
      return "Phone cannot get a location";
    default:
      return null;
  }
}
