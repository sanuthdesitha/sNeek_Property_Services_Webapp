/**
 * Thin delegate over the single shared haversine implementation in
 * lib/gps/distance.ts — kept so existing `@/lib/jobs/gps` imports
 * (gps-checkin / gps-checkout routes) continue to work. This variant returns
 * a rounded integer number of meters, matching its historical behaviour.
 */

import { haversine } from "@/lib/gps/distance";

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  return Math.round(haversine(lat1, lng1, lat2, lng2));
}
