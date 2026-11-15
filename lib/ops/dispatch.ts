import { JobAssignmentResponseStatus, JobStatus, Role } from "@prisma/client";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { listCleanerAvailabilities } from "@/lib/accounts/availability";
import { getAppSettings } from "@/lib/settings";
import { derivePreStartJobStatus } from "@/lib/jobs/assignment-workflow";
import { resolveAssignmentPayRate } from "@/lib/finance/assignment-rate";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { DISPATCH_AVAILABLE_BONUS, DISPATCH_DEFAULT_QA_SCORE, DISPATCH_UNAVAILABLE_PENALTY } from "@/lib/scheduling-rules/constants";
import { orderRouteStops, roughTravel } from "@/lib/ops/route-plan";

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function toUtcDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

interface CleanerScoreRow {
  cleanerId: string;
  cleanerName: string;
  email: string;
  score: number;
  qaScore: number;
  /** False when the cleaner has no QA review yet: qaScore is then the default the scorer assumes. */
  qaScoreKnown: boolean;
  suburbHistoryCount: number;
  currentLoad: number;
  /** The daily limit the load is measured against (settings.autoAssign.maxDailyJobsPerCleaner). */
  maxDailyJobs: number;
  /** Whether the cleaner's recorded availability fits (true when none is recorded). */
  availabilityFits: boolean;
  reasons: string[];
}

function toMinutes(value: string | null | undefined) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

function isCleanerAvailableForJob(input: {
  profile:
    | {
        weekly: Record<string, Array<{ start: string; end: string }>>;
        dateOverrides: Record<string, Array<{ start: string; end: string }>>;
      }
    | undefined;
  scheduledDate: Date;
  timezone: string;
  startTime?: string | null;
  dueTime?: string | null;
}) {
  const profile = input.profile;
  if (!profile) return true;

  const zonedDate = toZonedTime(input.scheduledDate, input.timezone);
  const dateKey = `${zonedDate.getFullYear()}-${String(zonedDate.getMonth() + 1).padStart(2, "0")}-${String(
    zonedDate.getDate()
  ).padStart(2, "0")}`;
  const weekdayKey = String(zonedDate.getDay());
  const slots = profile.dateOverrides[dateKey] ?? profile.weekly[weekdayKey] ?? [];
  if (!slots.length) return true;

  const startMinutes = toMinutes(input.startTime) ?? toMinutes(input.dueTime) ?? 8 * 60;
  const endMinutes =
    toMinutes(input.dueTime) ??
    (toMinutes(input.startTime) != null ? Math.min(24 * 60, (toMinutes(input.startTime) ?? 8 * 60) + 180) : 18 * 60);

  return slots.some((slot) => {
    const slotStart = toMinutes(slot.start) ?? 0;
    const slotEnd = toMinutes(slot.end) ?? 24 * 60;
    return startMinutes >= slotStart && endMinutes <= slotEnd;
  });
}

async function getCleanerQaAverages() {
  const reviews = await db.qAReview.findMany({
    include: {
      job: {
        select: {
          assignments: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const buckets = new Map<string, { total: number; count: number }>();
  for (const review of reviews) {
    for (const assignment of review.job.assignments) {
      const entry = buckets.get(assignment.userId) ?? { total: 0, count: 0 };
      entry.total += Number(review.score);
      entry.count += 1;
      buckets.set(assignment.userId, entry);
    }
  }

  const averages = new Map<string, number>();
  for (const [userId, value] of Array.from(buckets.entries())) {
    averages.set(userId, value.count > 0 ? value.total / value.count : 0);
  }
  return averages;
}

export async function suggestAutoAssignment(jobId: string) {
  const [settings, job] = await Promise.all([
    getAppSettings(),
    db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobType: true,
        propertyId: true,
        scheduledDate: true,
        property: { select: { suburb: true, name: true } },
      },
    }),
  ]);
  if (!job) throw new Error("Job not found.");
  if (!settings.autoAssign.enabled) return [];

  const scheduledKey = dateKey(job.scheduledDate);
  const dayStart = toUtcDateOnly(scheduledKey);
  const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [cleaners, assignmentsToday, suburbHistoryRows, qaAverages, cleanerAvailabilities] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, ...holdsRoleWhere(Role.CLEANER) },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    db.jobAssignment.findMany({
      where: {
        removedAt: null,
        job: { scheduledDate: { gte: dayStart, lt: nextDay } },
      },
      select: { userId: true, jobId: true },
    }),
    db.job.findMany({
      where: {
        property: { suburb: job.property.suburb },
        status: { in: ["COMPLETED", "INVOICED"] },
      },
      select: {
        assignments: {
          where: { removedAt: null },
          select: { userId: true },
        },
      },
      take: 300,
      orderBy: { updatedAt: "desc" },
    }),
    getCleanerQaAverages(),
    listCleanerAvailabilities(),
  ]);

  const loadByCleaner = new Map<string, number>();
  for (const row of assignmentsToday) {
    loadByCleaner.set(row.userId, (loadByCleaner.get(row.userId) ?? 0) + 1);
  }

  const suburbHistoryByCleaner = new Map<string, number>();
  for (const row of suburbHistoryRows) {
    for (const assignment of row.assignments) {
      suburbHistoryByCleaner.set(
        assignment.userId,
        (suburbHistoryByCleaner.get(assignment.userId) ?? 0) + 1
      );
    }
  }

  const maxHistory = Math.max(1, ...Array.from(suburbHistoryByCleaner.values(), (value) => value));
  const maxDaily = Math.max(1, settings.autoAssign.maxDailyJobsPerCleaner);

  const availabilityByCleaner = new Map(
    cleanerAvailabilities.map((profile) => [profile.userId, profile])
  );

  const scored: CleanerScoreRow[] = cleaners.map((cleaner) => {
    const currentLoad = loadByCleaner.get(cleaner.id) ?? 0;
    const qaKnown = qaAverages.has(cleaner.id);
    const qaScore = qaAverages.get(cleaner.id) ?? DISPATCH_DEFAULT_QA_SCORE;
    const historyCount = suburbHistoryByCleaner.get(cleaner.id) ?? 0;
    const historyScore = Math.min(100, (historyCount / maxHistory) * 100);
    const loadScore = Math.max(0, 100 - (currentLoad / maxDaily) * 100);
    const available = isCleanerAvailableForJob({
      profile: availabilityByCleaner.get(cleaner.id),
      scheduledDate: job.scheduledDate,
      timezone: settings.timezone || "Australia/Sydney",
    });

    const weighted =
      historyScore * (settings.autoAssign.weightSuburbHistory / 100) +
      qaScore * (settings.autoAssign.weightQaScore / 100) +
      loadScore * (settings.autoAssign.weightCurrentLoad / 100) +
      (available ? DISPATCH_AVAILABLE_BONUS : DISPATCH_UNAVAILABLE_PENALTY);

    return {
      cleanerId: cleaner.id,
      cleanerName: cleaner.name ?? cleaner.email,
      email: cleaner.email,
      score: Number(weighted.toFixed(2)),
      qaScore: Number(qaScore.toFixed(2)),
      qaScoreKnown: qaKnown,
      suburbHistoryCount: historyCount,
      currentLoad,
      maxDailyJobs: maxDaily,
      availabilityFits: available,
      reasons: [
        `QA ${qaScore.toFixed(1)}`,
        `Suburb history ${historyCount}`,
        `Today's load ${currentLoad}/${maxDaily}`,
        available ? "Availability fits schedule" : "Availability may not fit schedule",
      ],
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

export async function applyAutoAssignment(jobId: string, cleanerIds: string[], actorUserId: string) {
  if (cleanerIds.length === 0) throw new Error("No cleaner IDs provided.");
  const [settings, job] = await Promise.all([
    getAppSettings(),
    db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobType: true,
        status: true,
        // Needed so ops dispatch pays the same rate as the admin assign route.
        property: { select: { cleanerServiceRate: true } },
      },
    }),
  ]);
  if (!job) throw new Error("Job not found.");
  if (job.status === "CANCELLED") throw new Error("This job is cancelled. Restore it before assigning cleaners.");

  const uniqueCleanerIds = Array.from(new Set(cleanerIds));
  const changedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.jobAssignment.updateMany({
      where: { jobId, removedAt: null },
      data: { removedAt: changedAt },
    });
    for (let index = 0; index < uniqueCleanerIds.length; index += 1) {
      const userId = uniqueCleanerIds[index];
      const payRate =
        resolveAssignmentPayRate({
          perCleanerRate: settings.cleanerJobHourlyRates?.[userId]?.[job.jobType],
          propertyCleanerServiceRate: job.property?.cleanerServiceRate,
        }) ?? undefined;
      await tx.jobAssignment.upsert({
        where: { jobId_userId: { jobId, userId } },
        create: {
          jobId,
          userId,
          isPrimary: index === 0,
          payRate,
          offeredAt: changedAt,
          responseStatus: JobAssignmentResponseStatus.PENDING,
          assignedById: actorUserId,
        },
        update: {
          removedAt: null,
          isPrimary: index === 0,
          payRate,
          offeredAt: changedAt,
          responseStatus: JobAssignmentResponseStatus.PENDING,
          respondedAt: null,
          responseNote: null,
          assignedById: actorUserId,
          transferredFromUserId: null,
        },
      });
    }
    const activeAssignments = await tx.jobAssignment.findMany({
      where: { jobId, removedAt: null },
      select: { removedAt: true, responseStatus: true },
    });
    await tx.job.update({
      where: { id: jobId },
      data: {
        status: derivePreStartJobStatus(job.status, activeAssignments),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        jobId,
        action: "AUTO_ASSIGN_JOB",
        entity: "Job",
        entityId: jobId,
        after: { cleanerIds: uniqueCleanerIds } as any,
      },
    });
  });
}

/** One stop on a cleaner's day route (the shape every route API has always returned). */
export type DailyRouteStop = {
  jobId: string;
  propertyName: string;
  suburb: string;
  address: string;
  startTime: string | null;
  dueTime: string | null;
  jobType: string;
  status: string;
  estimatedTravelMinsFromPrev: number;
};

export type DailyRoute = {
  cleanerId: string;
  cleanerName: string;
  cleanerEmail: string;
  stops: DailyRouteStop[];
  totalEstimatedTravelMins: number;
};

/** The route map's richer stop: the same stop plus what the map and the assign dialog need. */
export type DetailedRouteStop = DailyRouteStop & {
  propertyId: string;
  latitude: number | null;
  longitude: number | null;
  /** Everyone on the job (for "Change cleaner…"), primary first. */
  assigneeIds: string[];
  primaryAssigneeId: string | null;
};

export type DetailedDailyRoute = Omit<DailyRoute, "stops"> & {
  /** The stops the rule shows (at most `stopLimit`), in the rule's order. */
  stops: DetailedRouteStop[];
  /** Stops on the route beyond the rule's limit: not shown, but counted so the page can say so. */
  hiddenStopCount: number;
  /** The "Routes: stops shown" rule (jobs.routeMaxStopsPerRun). */
  stopLimit: number;
};

/**
 * Every assigned cleaner's route for one day, by the Scheduling rules exactly
 * as they stand (owner instruction: the rules are not to be changed):
 *  - "Routes: group by suburb" On: suburb A to Z, then start time; Off: start time;
 *  - "Routes: stops shown": at most that many stops per route.
 * Travel is the rough suburb rule over the whole ordered route, from the first job.
 * `hiddenStopCount` reports the stops the limit leaves out (the route map says so).
 */
export async function buildDetailedRoutePlan(
  date: string,
  options?: { propertyIds?: string[] | null }
): Promise<DetailedDailyRoute[]> {
  const settings = await getAppSettings();
  const day = toUtcDateOnly(date);
  if (Number.isNaN(day.getTime())) throw new Error("Invalid date.");
  const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);

  const assignments = await db.jobAssignment.findMany({
    where: {
      removedAt: null,
      job: {
        scheduledDate: { gte: day, lt: nextDay },
        ...(Array.isArray(options?.propertyIds) && options?.propertyIds.length > 0
          ? { propertyId: { in: options.propertyIds } }
          : {}),
      },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      job: {
        select: {
          id: true,
          jobType: true,
          status: true,
          startTime: true,
          dueTime: true,
          propertyId: true,
          property: { select: { name: true, suburb: true, address: true, latitude: true, longitude: true } },
          assignments: { where: { removedAt: null }, select: { userId: true, isPrimary: true } },
        },
      },
    },
    orderBy: [{ userId: "asc" }, { job: { startTime: "asc" } }],
  });

  const groups = new Map<string, { cleanerId: string; cleanerName: string; cleanerEmail: string; stops: DetailedRouteStop[] }>();

  for (const row of assignments) {
    const key = row.userId;
    const current = groups.get(key) ?? {
      cleanerId: row.user.id,
      cleanerName: row.user.name ?? row.user.email,
      cleanerEmail: row.user.email,
      stops: [],
    };
    const assignees = [...(row.job.assignments ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    current.stops.push({
      jobId: row.job.id,
      propertyName: row.job.property.name,
      suburb: row.job.property.suburb,
      address: row.job.property.address,
      startTime: row.job.startTime ?? null,
      dueTime: row.job.dueTime ?? null,
      jobType: row.job.jobType,
      status: row.job.status,
      estimatedTravelMinsFromPrev: 0,
      propertyId: row.job.propertyId,
      latitude: row.job.property.latitude ?? null,
      longitude: row.job.property.longitude ?? null,
      assigneeIds: assignees.map((assignee) => assignee.userId),
      primaryAssigneeId: assignees.find((assignee) => assignee.isPrimary)?.userId ?? null,
    });
    groups.set(key, current);
  }

  const limit = settings.routeOptimization.maxStopsPerRun;
  const routes = Array.from(groups.values()).map((group): DetailedDailyRoute => {
    const sortedStops = orderRouteStops(group.stops, { groupBySuburb: settings.routeOptimization.groupBySuburb });
    const travel = roughTravel(sortedStops);
    const withTravel = sortedStops.map((stop, index) => ({ ...stop, estimatedTravelMinsFromPrev: travel.fromPrevious[index] }));
    const shown = withTravel.slice(0, limit);
    return {
      cleanerId: group.cleanerId,
      cleanerName: group.cleanerName,
      cleanerEmail: group.cleanerEmail,
      stops: shown,
      totalEstimatedTravelMins: travel.total,
      hiddenStopCount: withTravel.length - shown.length,
      stopLimit: limit,
    };
  });

  return routes.sort((a, b) => a.cleanerName.localeCompare(b.cleanerName));
}

/** The day's routes in the shape every route API and classic page has always used. */
export async function buildDailyRoutePlan(
  date: string,
  options?: { propertyIds?: string[] | null }
): Promise<DailyRoute[]> {
  const detailed = await buildDetailedRoutePlan(date, options);
  return detailed.map((route) => ({
    cleanerId: route.cleanerId,
    cleanerName: route.cleanerName,
    cleanerEmail: route.cleanerEmail,
    stops: route.stops.map((stop) => ({
      jobId: stop.jobId,
      propertyName: stop.propertyName,
      suburb: stop.suburb,
      address: stop.address,
      startTime: stop.startTime,
      dueTime: stop.dueTime,
      jobType: stop.jobType,
      status: stop.status,
      estimatedTravelMinsFromPrev: stop.estimatedTravelMinsFromPrev,
    })),
    totalEstimatedTravelMins: route.totalEstimatedTravelMins,
  }));
}
