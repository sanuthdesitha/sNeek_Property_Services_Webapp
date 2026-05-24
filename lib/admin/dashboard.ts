import { db } from "@/lib/db";
import { JobStatus, Role, QaAssignmentStatus, ClientInvoiceStatus } from "@prisma/client";
import { addDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const TZ = "Australia/Sydney";

type RawJob = {
  id: string;
  status: JobStatus;
  estimatedHours: number | null;
  actualHours: number | null;
  assignments: { payRate: number | null }[];
};

function jobValueEstimate(job: RawJob): number {
  const hours = job.actualHours ?? job.estimatedHours ?? 0;
  if (!hours) return 0;
  const rates = job.assignments
    .map((a) => a.payRate ?? 0)
    .filter((r) => r > 0);
  if (rates.length === 0) return 0;
  // crude proxy: bill = pay-rate × hours × 2.2 markup (rough industry markup)
  const avgRate = rates.reduce((s, r) => s + r, 0) / rates.length;
  return Math.round(avgRate * hours * 2.2);
}

const COMPLETED_STATUSES: JobStatus[] = [
  JobStatus.COMPLETED,
  JobStatus.INVOICED,
];

export type DashboardMetrics = Awaited<ReturnType<typeof getDashboardMetrics>>;

export async function getDashboardMetrics() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
  const tomorrowStart = todayEnd;
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 86_400_000);
  const weekStart = addDays(todayStart, -6);
  const enRouteCutoff = new Date(Date.now() - 5 * 60_000);

  const [
    todayJobsRaw,
    cleanersTotal,
    cleanersScheduledTomorrowIds,
    invoiceAgg,
    pendingQa,
    recentFeedback,
    enRoutePings,
    topCleaner,
  ] = await Promise.all([
    db.job
      .findMany({
        where: { scheduledDate: { gte: todayStart, lt: todayEnd } },
        select: {
          id: true,
          status: true,
          estimatedHours: true,
          actualHours: true,
          assignments: { select: { payRate: true } },
        },
      })
      .catch(() => [] as RawJob[]),
    db.user
      .count({ where: { role: Role.CLEANER, isActive: true } })
      .catch(() => 0),
    db.jobAssignment
      .findMany({
        where: {
          job: { scheduledDate: { gte: tomorrowStart, lt: tomorrowEnd } },
          removedAt: null,
        },
        select: { userId: true },
        distinct: ["userId"],
      })
      .catch(() => [] as { userId: string }[]),
    db.clientInvoice
      .aggregate({
        where: {
          status: { in: [ClientInvoiceStatus.APPROVED, ClientInvoiceStatus.SENT] },
        },
        _sum: { totalAmount: true },
        _count: { _all: true },
      })
      .catch(() => null),
    db.qaAssignment
      .count({
        where: { status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED] } },
      })
      .catch(() => 0),
    db.jobFeedback
      .findMany({
        where: {
          submittedAt: { not: null, gte: addDays(todayStart, -7) },
          rating: { not: null },
        },
        orderBy: { submittedAt: "desc" },
        take: 5,
        select: {
          id: true,
          jobId: true,
          rating: true,
          comment: true,
          submittedAt: true,
          client: { select: { name: true } },
        },
      })
      .catch(() => [] as Array<{
        id: string;
        jobId: string;
        rating: number | null;
        comment: string | null;
        submittedAt: Date | null;
        client: { name: string } | null;
      }>),
    db.cleanerLocationPing
      .findMany({
        where: { timestamp: { gte: enRouteCutoff } },
        select: { userId: true },
        distinct: ["userId"],
      })
      .catch(() => [] as { userId: string }[]),
    getTopCleanerThisWeek(weekStart, todayEnd),
  ]);

  // Revenue today: completed/invoiced jobs only
  const completedToday = todayJobsRaw.filter((j) =>
    COMPLETED_STATUSES.includes(j.status),
  );
  const revenueToday = completedToday.reduce(
    (sum, j) => sum + jobValueEstimate(j),
    0,
  );
  const remainingToday = todayJobsRaw.filter(
    (j) => !COMPLETED_STATUSES.includes(j.status),
  ).length;

  // Low stock count from PropertyStock rows where onHand <= reorderThreshold
  // (Prisma can't compare two columns directly, so we fetch & filter.)
  const stockRows = await db.propertyStock
    .findMany({ select: { onHand: true, reorderThreshold: true } })
    .catch(() => [] as { onHand: number; reorderThreshold: number }[]);
  const lowStockCount = stockRows.filter(
    (r) => r.onHand <= r.reorderThreshold,
  ).length;

  return {
    today: {
      revenueAud: revenueToday,
      completed: completedToday.length,
      remaining: remainingToday,
      total: todayJobsRaw.length,
    },
    tomorrow: {
      scheduled: cleanersScheduledTomorrowIds.length,
      total: cleanersTotal,
      idle: Math.max(0, cleanersTotal - cleanersScheduledTomorrowIds.length),
    },
    invoices: {
      outstandingCount: invoiceAgg?._count?._all ?? 0,
      outstandingAud: invoiceAgg?._sum?.totalAmount ?? 0,
    },
    qaPending: pendingQa,
    lowStockCount,
    enRouteCount: enRoutePings.length,
    recentFeedback,
    topCleaner,
  };
}

async function getTopCleanerThisWeek(weekStart: Date, weekEnd: Date) {
  try {
    // Find cleaner with most completed jobs in window
    const grouped = await db.jobAssignment.groupBy({
      by: ["userId"],
      where: {
        job: {
          scheduledDate: { gte: weekStart, lt: weekEnd },
          status: { in: COMPLETED_STATUSES },
        },
        removedAt: null,
      },
      _count: { _all: true },
      orderBy: { _count: { userId: "desc" } },
      take: 1,
    });
    if (!grouped.length) return null;
    const top = grouped[0];
    const user = await db.user.findUnique({
      where: { id: top.userId },
      select: { id: true, name: true, image: true },
    });
    if (!user) return null;

    // Try to get average rating across that cleaner's feedback this week
    const ratings = await db.jobFeedback
      .findMany({
        where: {
          submittedAt: { gte: weekStart, lt: weekEnd, not: null },
          rating: { not: null },
          job: {
            assignments: { some: { userId: top.userId, removedAt: null } },
          },
        },
        select: { rating: true },
      })
      .catch(() => [] as { rating: number | null }[]);
    const validRatings = ratings
      .map((r) => r.rating)
      .filter((r): r is number => typeof r === "number");
    const avgRating =
      validRatings.length > 0
        ? validRatings.reduce((s, n) => s + n, 0) / validRatings.length
        : null;

    return {
      userId: user.id,
      name: user.name ?? "Cleaner",
      image: user.image,
      jobsDone: top._count._all,
      avgRating,
    };
  } catch {
    return null;
  }
}
