/**
 * The route map's day, as the API sends it (plain module: the API route, the
 * loader, the workspace and tests). Nothing here is stored: routes are worked
 * out each time from today's assignments.
 */
import type { RouteTimeIssue } from "./route-plan";

/** Where a pin is drawn: the property's saved position, or its suburb's centre. */
export type RouteMapPosition = { lat: number; lng: number; precision: "property" | "suburb" };

export type RouteMapStop = {
  jobId: string;
  propertyName: string;
  address: string;
  suburb: string;
  startTime: string | null;
  dueTime: string | null;
  jobType: string;
  status: string;
  /** Rough minutes from the previous stop; 0 for the first. */
  travelFromPrevious: number;
  /** Null: no saved position and no other property in the suburb to place it by. */
  position: RouteMapPosition | null;
  assigneeIds: string[];
  primaryAssigneeId: string | null;
  /** Google Maps search for this one address. */
  mapsHref: string | null;
};

export type RouteMapRoute = {
  cleanerId: string;
  cleanerName: string;
  cleanerEmail: string;
  /** The letter on this cleaner's pins ("M", or "MS" when two share M). */
  letter: string;
  /** Index into the route looks (colour and line pattern). */
  lookIndex: number;
  stops: RouteMapStop[];
  totalTravelMinutes: number;
  /** Above this many stops the route carries a notice; every stop is still listed. */
  stopNoticeAbove: number;
  /** Consecutive Google Maps links, at most 10 stops each, covering every stop. */
  mapsLinks: Array<{ label: string; href: string }>;
  timeIssues: RouteTimeIssue[];
};

export type RouteMapSuggestion = {
  cleanerId: string;
  cleanerName: string;
  score: number;
  /** Null when the cleaner has no QA review yet (the scorer then assumes a default). */
  qaScore: number | null;
  suburbHistory: number;
  load: number;
  maxDailyJobs: number;
  availabilityFits: boolean;
};

/**
 * The existing scorer's answer for one job. "picked" is offered with an
 * "Assign …" button; "best_only" (availability may not fit) is shown but not
 * picked for you. Suggestions are read only: nothing is assigned here.
 */
export type RouteMapSuggestionState =
  | { state: "picked"; best: RouteMapSuggestion }
  | { state: "best_only"; best: RouteMapSuggestion }
  | { state: "none" }
  | { state: "off" }
  | { state: "not_checked" }
  | { state: "failed" };

export type RouteMapUnassignedJob = {
  jobId: string;
  jobNumber: string | null;
  propertyName: string;
  address: string;
  suburb: string;
  jobType: string;
  startTime: string | null;
  dueTime: string | null;
  guestCheckinTime: string | null;
  position: RouteMapPosition | null;
  suggestion: RouteMapSuggestionState;
};

export type RouteMapCleaner = { id: string; name: string; email: string };

export type RouteMapDay = {
  date: string;
  routes: RouteMapRoute[];
  unassigned: RouteMapUnassignedJob[];
  cleaners: RouteMapCleaner[];
  /** "Start time first, then suburb" or "Start time first". */
  groupBySuburb: boolean;
  /** Suggestions are worked out for at most this many jobs with nobody on them. */
  suggestionLimit: number;
};

export function isRouteMapDay(value: unknown): value is RouteMapDay {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<RouteMapDay>;
  return typeof body.date === "string" && Array.isArray(body.routes) && Array.isArray(body.unassigned) && Array.isArray(body.cleaners);
}
