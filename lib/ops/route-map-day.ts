import "server-only";
/**
 * The route map's day (`GET /api/admin/jobs/route-map`): every assigned
 * cleaner's route from `buildDailyRoutePlan`, the day's jobs with nobody on
 * them with the existing automatic-assignment scorer's best match, and the
 * active cleaners for the shared assign dialog.
 *
 * READ ONLY. Suggestions come from `suggestAutoAssignment`, which only reads;
 * nothing here assigns, offers or notifies. "Assign …" on the page opens the
 * job's own assign dialog, which posts to the existing assign route.
 */
import { JobStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { buildGoogleMapsDirectionsUrl } from "@/lib/jobs/schedule-order";
import { getAppSettings } from "@/lib/settings";
import { suburbCentres, suburbKey, type LatLng } from "@/lib/maps/suburb-centre";
import { buildDailyRoutePlan, suggestAutoAssignment } from "./dispatch";
import { routeLetters, routeMapsLinks, routeTimeIssues } from "./route-plan";
import type { RouteMapDay, RouteMapPosition, RouteMapSuggestionState, RouteMapUnassignedJob } from "./route-map-types";

/** The scorer reads several tables per job; it runs for at most this many jobs per day view. */
export const ROUTE_MAP_SUGGESTION_LIMIT = 8;

const NOT_OPEN: JobStatus[] = [JobStatus.CANCELLED, JobStatus.COMPLETED, JobStatus.INVOICED];

function position(lat: number | null, lng: number | null, suburb: string, centres: Map<string, LatLng>): RouteMapPosition | null {
  if (typeof lat === "number" && typeof lng === "number") return { lat, lng, precision: "property" };
  const centre = centres.get(suburbKey(suburb));
  return centre ? { ...centre, precision: "suburb" } : null;
}

async function bestSuggestion(jobId: string): Promise<RouteMapSuggestionState> {
  try {
    const scored = await suggestAutoAssignment(jobId);
    const best = scored[0];
    if (!best) return { state: "none" };
    const suggestion = {
      cleanerId: best.cleanerId,
      cleanerName: best.cleanerName,
      score: best.score,
      qaScore: best.qaScoreKnown ? best.qaScore : null,
      suburbHistory: best.suburbHistoryCount,
      load: best.currentLoad,
      maxDailyJobs: best.maxDailyJobs,
      availabilityFits: best.availabilityFits,
    };
    return best.availabilityFits ? { state: "picked", best: suggestion } : { state: "best_only", best: suggestion };
  } catch {
    return { state: "failed" };
  }
}

async function unassignedJobs(date: string, centres: Map<string, LatLng>, suggestionsOn: boolean): Promise<RouteMapUnassignedJob[]> {
  const day = new Date(`${date}T00:00:00.000Z`);
  const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  const rows = await db.job.findMany({
    where: {
      scheduledDate: { gte: day, lt: nextDay },
      status: { notIn: NOT_OPEN },
      assignments: { none: { removedAt: null } },
    },
    orderBy: [{ startTime: "asc" }, { id: "asc" }],
    select: {
      id: true, jobNumber: true, jobType: true, startTime: true, dueTime: true, sameDayCheckinTime: true, internalNotes: true, cleanSkipStatus: true,
      property: { select: { name: true, suburb: true, address: true, latitude: true, longitude: true } },
    },
  });
  const open = rows.filter((row) => !parseJobInternalNotes(row.internalNotes).isDraft && row.cleanSkipStatus !== "SKIPPED");
  // Timed jobs first (the store sorts nulls last on Postgres; this keeps it explicit).
  open.sort((a, b) => (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99"));
  const result: RouteMapUnassignedJob[] = [];
  for (let index = 0; index < open.length; index += 1) {
    const row = open[index];
    const suggestion: RouteMapSuggestionState = !suggestionsOn ? { state: "off" } : index < ROUTE_MAP_SUGGESTION_LIMIT ? await bestSuggestion(row.id) : { state: "not_checked" };
    result.push({
      jobId: row.id,
      jobNumber: row.jobNumber ?? null,
      propertyName: row.property.name,
      address: row.property.address,
      suburb: row.property.suburb,
      jobType: row.jobType,
      startTime: row.startTime ?? null,
      dueTime: row.dueTime ?? null,
      guestCheckinTime: row.sameDayCheckinTime ?? null,
      position: position(row.property.latitude, row.property.longitude, row.property.suburb, centres),
      suggestion,
    });
  }
  return result;
}

export async function loadRouteMapDay(date: string): Promise<RouteMapDay> {
  const [settings, plan, placedProperties, cleaners] = await Promise.all([
    getAppSettings(),
    buildDailyRoutePlan(date),
    db.property.findMany({ where: { isActive: true, latitude: { not: null }, longitude: { not: null } }, select: { suburb: true, latitude: true, longitude: true } }),
    db.user.findMany({ where: { isActive: true, ...holdsRoleWhere(Role.CLEANER) }, select: { id: true, name: true, email: true }, orderBy: [{ name: "asc" }, { email: "asc" }] }),
  ]);
  const centres = suburbCentres(placedProperties);
  const letters = routeLetters(plan);
  const routes = plan.map((route, index) => ({
    cleanerId: route.cleanerId,
    cleanerName: route.cleanerName,
    cleanerEmail: route.cleanerEmail,
    letter: letters.get(route.cleanerId) ?? "?",
    lookIndex: index,
    totalTravelMinutes: route.totalEstimatedTravelMins,
    stopNoticeAbove: route.stopNoticeAbove,
    mapsLinks: routeMapsLinks(route.stops.map((stop) => `${stop.address}, ${stop.suburb}`)),
    timeIssues: routeTimeIssues(route.stops),
    stops: route.stops.map((stop) => ({
      jobId: stop.jobId,
      propertyName: stop.propertyName,
      address: stop.address,
      suburb: stop.suburb,
      startTime: stop.startTime,
      dueTime: stop.dueTime,
      jobType: stop.jobType,
      status: stop.status,
      travelFromPrevious: stop.estimatedTravelMinsFromPrev,
      position: position(stop.latitude, stop.longitude, stop.suburb, centres),
      assigneeIds: stop.assigneeIds,
      primaryAssigneeId: stop.primaryAssigneeId,
      mapsHref: buildGoogleMapsDirectionsUrl({ address: stop.address, suburb: stop.suburb, name: stop.propertyName }),
    })),
  }));
  return {
    date,
    routes,
    unassigned: await unassignedJobs(date, centres, settings.autoAssign.enabled),
    cleaners: cleaners.map((cleaner) => ({ id: cleaner.id, name: cleaner.name ?? cleaner.email, email: cleaner.email })),
    groupBySuburb: settings.routeOptimization.groupBySuburb,
    suggestionLimit: ROUTE_MAP_SUGGESTION_LIMIT,
  };
}
