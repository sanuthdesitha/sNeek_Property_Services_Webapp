import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

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
  suburbHistoryCount: number;
  currentLoad: number;
  reasons: string[];
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

  const [cleaners, assignmentsToday, suburbHistoryRows, qaAverages] = await Promise.all([
    db.user.findMany({
      where: { role: Role.CLEANER, isActive: true },
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

  const scored: CleanerScoreRow[] = cleaners.map((cleaner) => {
    const currentLoad = loadByCleaner.get(cleaner.id) ?? 0;
    const qaScore = qaAverages.get(cleaner.id) ?? 70;
    const historyCount = suburbHistoryByCleaner.get(cleaner.id) ?? 0;
    const historyScore = Math.min(100, (historyCount / maxHistory) * 100);
    const loadScore = Math.max(0, 100 - (currentLoad / maxDaily) * 100);

    const weighted =
      historyScore * (settings.autoAssign.weightSuburbHistory / 100) +
      qaScore * (settings.autoAssign.weightQaScore / 100) +
      loadScore * (settings.autoAssign.weightCurrentLoad / 100);

    return {
      cleanerId: cleaner.id,
      cleanerName: cleaner.name ?? cleaner.email,
      email: cleaner.email,
      score: Number(weighted.toFixed(2)),
      qaScore: Number(qaScore.toFixed(2)),
      suburbHistoryCount: historyCount,
      currentLoad,
      reasons: [
        `QA ${qaScore.toFixed(1)}`,
        `Suburb history ${historyCount}`,
        `Today's load ${currentLoad}/${maxDaily}`,
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
      select: { id: true, jobType: true },
    }),
  ]);
  if (!job) throw new Error("Job not found.");

  const uniqueCleanerIds = Array.from(new Set(cleanerIds));
  await db.$transaction(async (tx) => {
    await tx.jobAssignment.updateMany({
      where: { jobId, removedAt: null },
      data: { removedAt: new Date() },
    });
    await tx.jobAssignment.createMany({
      data: uniqueCleanerIds.map((userId, index) => ({
        jobId,
        userId,
        isPrimary: index === 0,
        payRate: settings.cleanerJobHourlyRates?.[userId]?.[job.jobType] ?? undefined,
      })),
      skipDuplicates: true,
    });
    await tx.job.update({
      where: { id: jobId },
      data: { status: "ASSIGNED" },
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

export async function buildDailyRoutePlan(
  date: string,
  options?: { propertyIds?: string[] | null }
) {
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
          property: { select: { name: true, suburb: true, address: true } },
        },
      },
    },
    orderBy: [{ userId: "asc" }, { job: { startTime: "asc" } }],
  });

  const groups = new Map<
    string,
    {
      cleanerId: string;
      cleanerName: string;
      cleanerEmail: string;
      stops: Array<{
        jobId: string;
        propertyName: string;
        suburb: string;
        address: string;
        startTime: string | null;
        dueTime: string | null;
        jobType: string;
        status: string;
        estimatedTravelMinsFromPrev: number;
      }>;
      totalEstimatedTravelMins: number;
    }
  >();

  for (const row of assignments) {
    const key = row.userId;
    const current = groups.get(key) ?? {
      cleanerId: row.user.id,
      cleanerName: row.user.name ?? row.user.email,
      cleanerEmail: row.user.email,
      stops: [],
      totalEstimatedTravelMins: 0,
    };
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
    });
    groups.set(key, current);
  }

  const routes = Array.from(groups.values()).map((group) => {
    const sortedStops = [...group.stops].sort((a, b) => {
      if (settings.routeOptimization.groupBySuburb) {
        const suburbCompare = a.suburb.localeCompare(b.suburb);
        if (suburbCompare !== 0) return suburbCompare;
      }
      return (a.startTime ?? "23:59").localeCompare(b.startTime ?? "23:59");
    });

    let totalTravel = 0;
    for (let index = 0; index < sortedStops.length; index += 1) {
      if (index === 0) continue;
      const prev = sortedStops[index - 1];
      const curr = sortedStops[index];
      const estimated = prev.suburb === curr.suburb ? 8 : 22;
      curr.estimatedTravelMinsFromPrev = estimated;
      totalTravel += estimated;
    }
    return {
      ...group,
      stops: sortedStops.slice(0, settings.routeOptimization.maxStopsPerRun),
      totalEstimatedTravelMins: totalTravel,
    };
  });

  return routes.sort((a, b) => a.cleanerName.localeCompare(b.cleanerName));
}
