/**
 * Chained laundry-driver ETA math for the cleaner-facing "where's my linen?"
 * card. Pure — no Prisma, no fetch (the Distance Matrix call is injected as
 * `legEtaFn`) — unit-tested in tests/lib/eta-chain.test.ts.
 *
 * Model:
 *  - N = 0 (this property is the driver's next stop): try `legEtaFn`
 *    (Google Distance Matrix in prod — may resolve null when no server key is
 *    configured) and fall back to the naive haversine estimate.
 *  - N ≥ 1: naive legs only (driver → s1 → … → sN → target) at NAIVE_SPEED_KMH
 *    plus N × NAIVE_PER_STOP_MIN minutes of service time at the intermediate
 *    stops — deliberately cheap, no Distance Matrix fan-out.
 *  - Result is rounded UP to 5-minute precision, minimum 5.
 */
import { haversine } from "@/lib/gps/distance";
import { NAIVE_PER_STOP_MIN, NAIVE_SPEED_KMH } from "@/lib/laundry/route-plan";

export type LatLng = { lat: number; lng: number };

export const ETA_ROUND_TO_MIN = 5;
export const ETA_FLOOR_MIN = 5;

/** Naive driving minutes between two points: haversine at NAIVE_SPEED_KMH. */
export function naiveLegMinutes(from: LatLng, to: LatLng): number {
  const km = haversine(from.lat, from.lng, to.lat, to.lng) / 1000;
  return (km / NAIVE_SPEED_KMH) * 60;
}

/** Round up to ETA_ROUND_TO_MIN precision, never below ETA_FLOOR_MIN. */
export function roundEtaMinutes(rawMinutes: number): number {
  const rounded = Math.ceil(rawMinutes / ETA_ROUND_TO_MIN) * ETA_ROUND_TO_MIN;
  return Math.max(ETA_FLOOR_MIN, rounded);
}

export async function estimateChainedEtaMinutes(input: {
  driverPos: LatLng;
  /** Positions of the N intermediate incomplete stops, in run order. */
  stops: LatLng[];
  target: LatLng;
  /**
   * Optional precise single-leg estimator (Distance Matrix). Only consulted
   * for the direct N=0 leg; resolving null falls back to the naive estimate.
   */
  legEtaFn?: (from: LatLng, to: LatLng) => Promise<number | null>;
  /**
   * Service-time stop count when it differs from `stops.length` (e.g. some
   * intermediate stops have no coordinates and were dropped from the chain
   * but the driver still has to service them). Defaults to `stops.length`.
   */
  serviceStopCount?: number;
}): Promise<number> {
  const { driverPos, stops, target, legEtaFn } = input;
  const serviceStops = Math.max(input.serviceStopCount ?? stops.length, stops.length);

  if (stops.length === 0 && serviceStops === 0) {
    const precise = legEtaFn ? await legEtaFn(driverPos, target) : null;
    const direct = precise ?? naiveLegMinutes(driverPos, target);
    return roundEtaMinutes(direct);
  }

  let minutes = 0;
  let prev = driverPos;
  for (const stop of stops) {
    minutes += naiveLegMinutes(prev, stop);
    prev = stop;
  }
  minutes += naiveLegMinutes(prev, target);
  minutes += serviceStops * NAIVE_PER_STOP_MIN;
  return roundEtaMinutes(minutes);
}
