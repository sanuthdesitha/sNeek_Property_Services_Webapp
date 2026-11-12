import "server-only";
/**
 * The tracking window — WHEN a person's location may be recorded — in one
 * place, enforced by every ingest route and by the probes the trackers ask
 * whether to run (defaults pending owner confirmation, 2026-11-14):
 *
 * Cleaners: from "on the way" (EN_ROUTE) until clock-out, on TODAY's job
 * (Sydney day) only. Never while the job is PAUSED or IN_PROGRESS without
 * THIS cleaner's own open clock, never on another day's job, never while an
 * administrator is impersonating them.
 *
 * Laundry drivers: only while they have an ACTIVE route dated today. ADMIN
 * and OPS_MANAGER are never tracked, and never while impersonated.
 *
 * The pure half (`evaluateCleanerJobWindow`, `evaluateDriverRouteWindow`) is
 * unit-tested; the resolvers read the facts from the database.
 */
import { JobStatus, LocationPingSource, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sydneyDayEndInclusive, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { nextIncompleteStop, parseRouteStops } from "@/lib/laundry/route-plan";
import { TRACKED_STATUSES } from "./tracked-statuses";

export type TrackingRefusal =
  | "IMPERSONATING"
  | "WRONG_ROLE"
  | "NO_ACTIVE_JOB"
  | "NOT_ASSIGNED"
  | "NOT_TODAY"
  | "NOT_TRACKED_STATUS"
  | "CLOCK_STOPPED"
  | "NO_ACTIVE_ROUTE";

/** Why the window is closed, in words the person can act on. */
export const TRACKING_REFUSAL_TEXT: Record<TrackingRefusal, string> = {
  IMPERSONATING: "Location is never recorded while the office is viewing as you.",
  WRONG_ROLE: "Location is only recorded for cleaners and laundry drivers.",
  NO_ACTIVE_JOB: "You have no job on the way or clocked in today.",
  NOT_ASSIGNED: "You are not assigned to this job.",
  NOT_TODAY: "Location is only recorded for today's jobs.",
  NOT_TRACKED_STATUS: "This job is not on the way or in progress.",
  CLOCK_STOPPED: "Your clock is stopped, so your location is not recorded.",
  NO_ACTIVE_ROUTE: "You have no active laundry route today.",
};

export type CleanerJobFacts = {
  status: string;
  scheduledDate: Date;
  assigned: boolean;
  cleanSkipped: boolean;
  /** This cleaner's open time log on this job, if any. */
  ownOpenTimerStartedAt: Date | null;
};

export type WindowDecision<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; reason: TrackingRefusal };

function todayRange(now: Date) {
  const key = sydneyTodayKey(now);
  return { start: sydneyDayStart(key), end: sydneyDayEndInclusive(key) };
}

/** Pure: may THIS cleaner's location be recorded against THIS job now? */
export function evaluateCleanerJobWindow(
  facts: CleanerJobFacts,
  input: { now: Date; impersonating: boolean },
): WindowDecision<{ source: LocationPingSource; clockRunning: boolean }> {
  if (input.impersonating) return { ok: false, reason: "IMPERSONATING" };
  if (!facts.assigned) return { ok: false, reason: "NOT_ASSIGNED" };
  if (facts.cleanSkipped) return { ok: false, reason: "NOT_TRACKED_STATUS" };
  const { start, end } = todayRange(input.now);
  const scheduledToday = facts.scheduledDate >= start && facts.scheduledDate <= end;
  const timerStartedToday = facts.ownOpenTimerStartedAt != null && facts.ownOpenTimerStartedAt >= start;
  if (!scheduledToday && !timerStartedToday) return { ok: false, reason: "NOT_TODAY" };
  if (facts.status === JobStatus.EN_ROUTE) return { ok: true, source: LocationPingSource.CLEANER_DRIVING, clockRunning: facts.ownOpenTimerStartedAt != null };
  if (!(TRACKED_STATUSES as string[]).includes(facts.status)) return { ok: false, reason: "NOT_TRACKED_STATUS" };
  if (!facts.ownOpenTimerStartedAt) return { ok: false, reason: "CLOCK_STOPPED" };
  return { ok: true, source: LocationPingSource.CLEANER_JOB, clockRunning: true };
}

export type DriverRouteFacts = {
  status: string;
  date: Date;
  stops: unknown;
};

/** Pure: may this driver be tracked on this route now? */
export function evaluateDriverRouteWindow(
  route: DriverRouteFacts | null,
  input: { now: Date; impersonating: boolean; role: string },
): WindowDecision {
  if (input.impersonating) return { ok: false, reason: "IMPERSONATING" };
  if (input.role !== "LAUNDRY") return { ok: false, reason: "WRONG_ROLE" };
  if (!route || route.status !== "ACTIVE") return { ok: false, reason: "NO_ACTIVE_ROUTE" };
  const { start, end } = todayRange(input.now);
  if (route.date < start || route.date > end) return { ok: false, reason: "NO_ACTIVE_ROUTE" };
  if (parseRouteStops(route.stops).length === 0) return { ok: false, reason: "NO_ACTIVE_ROUTE" };
  return { ok: true };
}

type Reader = Prisma.TransactionClient | typeof db;

export type CleanerWindowJob = {
  id: string;
  status: JobStatus;
  propertyName: string;
  clientShowsLiveLocation: boolean;
  clockStartedAt: Date | null;
  property: { latitude: number | null; longitude: number | null; geofenceRadiusM: number | null };
};

const JOB_SELECT = {
  id: true,
  status: true,
  scheduledDate: true,
  cleanSkipStatus: true,
  property: {
    select: {
      name: true,
      latitude: true,
      longitude: true,
      geofenceRadiusM: true,
      client: { select: { showCleanerLiveLocation: true } },
    },
  },
} satisfies Prisma.JobSelect;

type LoadedJob = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

function toWindowJob(job: LoadedJob, timerStartedAt: Date | null): CleanerWindowJob {
  return {
    id: job.id,
    status: job.status,
    propertyName: job.property.name,
    clientShowsLiveLocation: job.property.client?.showCleanerLiveLocation === true,
    clockStartedAt: timerStartedAt,
    property: {
      latitude: job.property.latitude ?? null,
      longitude: job.property.longitude ?? null,
      geofenceRadiusM: job.property.geofenceRadiusM ?? null,
    },
  };
}

/** Check one specific job (an ingest that names its job). */
export async function resolveCleanerJobWindow(
  input: { userId: string; jobId: string; impersonating: boolean; now?: Date },
  reader: Reader = db,
): Promise<WindowDecision<{ source: LocationPingSource; job: CleanerWindowJob }>> {
  const now = input.now ?? new Date();
  if (input.impersonating) return { ok: false, reason: "IMPERSONATING" };
  const job = await reader.job.findFirst({
    where: { id: input.jobId, assignments: { some: { userId: input.userId, removedAt: null } } },
    select: JOB_SELECT,
  });
  if (!job) return { ok: false, reason: "NOT_ASSIGNED" };
  const timer = await reader.timeLog.findFirst({
    where: { jobId: job.id, userId: input.userId, stoppedAt: null },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  const decision = evaluateCleanerJobWindow(
    {
      status: job.status,
      scheduledDate: job.scheduledDate,
      assigned: true,
      cleanSkipped: job.cleanSkipStatus === "SKIPPED",
      ownOpenTimerStartedAt: timer?.startedAt ?? null,
    },
    { now, impersonating: false },
  );
  if (!decision.ok) return decision;
  return { ok: true, source: decision.source, job: toWindowJob(job, timer?.startedAt ?? null) };
}

/**
 * The job this cleaner is being tracked on right now, if any: the job with
 * their own open clock first, else today's EN_ROUTE job most recently moved.
 */
export async function resolveActiveCleanerWindow(
  input: { userId: string; impersonating: boolean; now?: Date },
  reader: Reader = db,
): Promise<WindowDecision<{ source: LocationPingSource; job: CleanerWindowJob }>> {
  const now = input.now ?? new Date();
  if (input.impersonating) return { ok: false, reason: "IMPERSONATING" };
  const { start, end } = todayRange(now);
  const openTimers = await reader.timeLog.findMany({
    where: { userId: input.userId, stoppedAt: null, startedAt: { gte: start } },
    orderBy: { startedAt: "desc" },
    select: { jobId: true },
    take: 5,
  });
  for (const timer of openTimers) {
    const decision = await resolveCleanerJobWindow({ userId: input.userId, jobId: timer.jobId, impersonating: false, now }, reader);
    if (decision.ok) return decision;
  }
  const enRoute = await reader.job.findMany({
    where: {
      status: JobStatus.EN_ROUTE,
      scheduledDate: { gte: start, lte: end },
      assignments: { some: { userId: input.userId, removedAt: null } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true },
    take: 5,
  });
  for (const job of enRoute) {
    const decision = await resolveCleanerJobWindow({ userId: input.userId, jobId: job.id, impersonating: false, now }, reader);
    if (decision.ok) return decision;
  }
  return { ok: false, reason: "NO_ACTIVE_JOB" };
}

export type DriverWindowRoute = {
  id: string;
  /** The job behind the next stop (the ping table requires a job). */
  anchorJobId: string;
  stops: ReturnType<typeof parseRouteStops>;
};

/** The driver's ACTIVE route today and the job their pings are filed against. */
export async function resolveDriverWindow(
  input: { userId: string; role: string; impersonating: boolean; now?: Date },
  reader: Reader = db,
): Promise<WindowDecision<{ route: DriverWindowRoute }>> {
  const now = input.now ?? new Date();
  if (input.impersonating) return { ok: false, reason: "IMPERSONATING" };
  if (input.role !== "LAUNDRY") return { ok: false, reason: "WRONG_ROLE" };
  const { start, end } = todayRange(now);
  const route = await reader.laundryRoute.findFirst({
    where: { userId: input.userId, status: "ACTIVE", date: { gte: start, lte: end } },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, date: true, stops: true },
  });
  const decision = evaluateDriverRouteWindow(route, { now, impersonating: false, role: input.role });
  if (!decision.ok || !route) return decision.ok ? { ok: false, reason: "NO_ACTIVE_ROUTE" } : decision;
  const stops = parseRouteStops(route.stops);
  const stop = nextIncompleteStop(stops) ?? stops[stops.length - 1];
  const task = stop ? await reader.laundryTask.findUnique({ where: { id: stop.taskId }, select: { jobId: true } }) : null;
  if (!task) return { ok: false, reason: "NO_ACTIVE_ROUTE" };
  return { ok: true, route: { id: route.id, anchorJobId: task.jobId, stops } };
}
