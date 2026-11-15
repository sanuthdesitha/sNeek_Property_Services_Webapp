/**
 * The route map's view model (plain module: workspace, map, list and tests).
 * Turns the API's day into list filters, pins and lines. Pure: no requests,
 * no Google types.
 */
import { STATUS_LABELS } from "@/lib/jobs/status-labels";
import { routeLook, ROUTE_PATTERN_WORDS, roughDurationWords } from "@/lib/ops/route-plan";
import type { RouteMapDay, RouteMapRoute, RouteMapStop, RouteMapUnassignedJob } from "@/lib/ops/route-map-types";
import type { RouteStopPinLook } from "@/components/v2/admin/ops/ops-map-pin-views";

/** "all", "nobody" (jobs with nobody on them) or a cleaner id. */
export type RouteShowFilter = string;

export type RouteFilter = { search: string; show: RouteShowFilter };

export type MapPin = { key: string; lat: number; lng: number; look: RouteStopPinLook; ariaLabel: string };

export type MapRouteLine = { cleanerId: string; lookIndex: number; path: Array<{ lat: number; lng: number }> };

export function stopKey(cleanerId: string, jobId: string): string {
  return `s:${cleanerId}:${jobId}`;
}

export function unassignedKey(jobId: string): string {
  return `u:${jobId}`;
}

export function timeRange(startTime: string | null, dueTime: string | null): string {
  if (startTime && dueTime) return `${startTime} – ${dueTime}`;
  if (startTime) return `from ${startTime}`;
  if (dueTime) return `start time not set · due ${dueTime}`;
  return "start time not set";
}

export function statusWords(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ").toLowerCase();
}

export function jobTypeWords(type: string): string {
  const text = type.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

function stopMatches(stop: Pick<RouteMapStop, "propertyName" | "suburb" | "address">, needle: string): boolean {
  return [stop.propertyName, stop.suburb, stop.address].some((value) => normalise(value).includes(needle));
}

/** Whether a route is shown: the "Show on map" choice, then the search (cleaner, property or suburb). */
export function routeVisible(route: RouteMapRoute, filter: RouteFilter): boolean {
  if (filter.show === "nobody") return false;
  if (filter.show !== "all" && filter.show !== route.cleanerId) return false;
  const needle = normalise(filter.search);
  if (!needle) return true;
  return normalise(route.cleanerName).includes(needle) || route.stops.some((stop) => stopMatches(stop, needle));
}

export function unassignedVisible(job: RouteMapUnassignedJob, filter: RouteFilter): boolean {
  if (filter.show !== "all" && filter.show !== "nobody") return false;
  const needle = normalise(filter.search);
  return !needle || stopMatches(job, needle);
}

function stopAriaLabel(route: RouteMapRoute, stop: RouteMapStop, index: number): string {
  const where = stop.position?.precision === "suburb" ? ` Shown at the ${stop.suburb} suburb centre: the property has no saved map position.` : "";
  return `${route.letter}${index + 1}: ${route.cleanerName}, stop ${index + 1} of ${route.stops.length}, ${stop.propertyName}, ${timeRange(stop.startTime, stop.dueTime)}, ${statusWords(stop.status)}.${where}`;
}

function unassignedAriaLabel(job: RouteMapUnassignedJob): string {
  const where = job.position?.precision === "suburb" ? ` Shown at the ${job.suburb} suburb centre.` : "";
  return `Nobody on it: ${job.propertyName}, ${timeRange(job.startTime, job.dueTime)}.${where}`;
}

/** Pins for everything visible that has a map position. */
export function buildMapPins(day: RouteMapDay, filter: RouteFilter): MapPin[] {
  const pins: MapPin[] = [];
  for (const job of day.unassigned) {
    if (!job.position || !unassignedVisible(job, filter)) continue;
    pins.push({
      key: unassignedKey(job.jobId),
      lat: job.position.lat,
      lng: job.position.lng,
      look: { text: "?", colourToken: null, atSuburb: job.position.precision === "suburb", selected: false },
      ariaLabel: unassignedAriaLabel(job),
    });
  }
  for (const route of day.routes) {
    if (!routeVisible(route, filter)) continue;
    const look = routeLook(route.lookIndex);
    route.stops.forEach((stop, index) => {
      if (!stop.position) return;
      pins.push({
        key: stopKey(route.cleanerId, stop.jobId),
        lat: stop.position.lat,
        lng: stop.position.lng,
        look: { text: `${route.letter}${index + 1}`, colourToken: look.colourToken, atSuburb: stop.position.precision === "suburb", selected: false },
        ariaLabel: stopAriaLabel(route, stop, index),
      });
    });
  }
  return pins;
}

/** One line per visible route, through its placed stops in route order. */
export function buildMapLines(day: RouteMapDay, filter: RouteFilter): MapRouteLine[] {
  return day.routes
    .filter((route) => routeVisible(route, filter))
    .map((route) => ({
      cleanerId: route.cleanerId,
      lookIndex: route.lookIndex,
      path: route.stops.flatMap((stop) => (stop.position ? [{ lat: stop.position.lat, lng: stop.position.lng }] : [])),
    }));
}

/** "Maria, solid" for the key. */
export function routeKeyWords(route: RouteMapRoute): string {
  const first = route.cleanerName.trim().split(/\s+/)[0] ?? route.cleanerName;
  return route.stops.length < 2 ? `${first}, one stop` : `${first}, ${ROUTE_PATTERN_WORDS[routeLook(route.lookIndex).pattern]}`;
}

export type RouteDayFacts = {
  routes: number;
  stops: number;
  inProgress: number;
  notStarted: number;
  nobody: number;
  firstNobodyStart: string | null;
  travelMinutes: number;
};

const STARTED = new Set(["EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"]);
const NOT_STARTED = new Set(["UNASSIGNED", "OFFERED", "ASSIGNED"]);

export function routeDayFacts(day: RouteMapDay): RouteDayFacts {
  const stops = day.routes.flatMap((route) => route.stops);
  const timed = day.unassigned.map((job) => job.startTime).filter((value): value is string => Boolean(value)).sort();
  return {
    routes: day.routes.length,
    stops: stops.length,
    inProgress: stops.filter((stop) => STARTED.has(stop.status)).length,
    notStarted: stops.filter((stop) => NOT_STARTED.has(stop.status)).length,
    nobody: day.unassigned.length,
    firstNobodyStart: timed[0] ?? null,
    travelMinutes: day.routes.reduce((sum, route) => sum + route.totalTravelMinutes, 0),
  };
}

export function travelWords(minutes: number): string {
  return roughDurationWords(minutes);
}

/** The flag a route carries in its title band, or null for an untroubled route. */
export function routeFlag(route: RouteMapRoute): { pill: string; summary: string } | null {
  const outOfOrder = route.timeIssues.find((issue) => issue.kind === "out_of_order");
  if (outOfOrder) {
    return { pill: "Out of time order", summary: `stop ${outOfOrder.stopIndex + 1} starts before stop ${outOfOrder.earlierIndex + 1}` };
  }
  const overlap = route.timeIssues.find((issue) => issue.kind === "overlap");
  if (overlap) {
    return { pill: "Times overlap", summary: `stop ${overlap.stopIndex + 1} starts before stop ${overlap.earlierIndex + 1} is due to finish` };
  }
  if (route.stops.length > route.stopNoticeAbove) return { pill: `More than ${route.stopNoticeAbove} stops`, summary: "every stop listed" };
  return null;
}
