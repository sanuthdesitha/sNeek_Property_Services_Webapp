/**
 * Property history and cleaner history are the All issues register
 * pre-filtered (pilot "All issues register"): the last 12 months for one
 * property or one cleaner. Pure.
 */
import { addDaysToKey, sydneyTodayKey } from "@/lib/time/sydney-range";

export const REGISTER_HISTORY_DAYS = 365;

export function registerHistoryHref(filter: { propertyId: string } | { cleanerId: string }, now: Date = new Date()): string {
  const todayKey = sydneyTodayKey(now);
  const params = new URLSearchParams({ tab: "register", period: "custom", from: addDaysToKey(todayKey, -(REGISTER_HISTORY_DAYS - 1)), to: todayKey });
  if ("propertyId" in filter) params.set("propertyId", filter.propertyId);
  else params.set("cleanerId", filter.cleanerId);
  return `/v2/admin/quality?${params.toString()}`;
}
