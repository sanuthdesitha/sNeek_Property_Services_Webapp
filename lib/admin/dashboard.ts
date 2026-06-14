import { db } from "@/lib/db";
import { JobStatus, Role, QaAssignmentStatus, ClientInvoiceStatus, JobType } from "@prisma/client";
import { addDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { computeClientCharge, type ClientChargeRates } from "@/lib/finance/job-money";

const TZ = "Australia/Sydney";

type RawJob = {
  id: string;
  status: JobStatus;
  jobType: JobType;
  propertyId: string;
  fixedPrice: number | null;
};

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
          jobType: true,
          propertyId: true,
          fixedPrice: true,
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

  // Revenue today: completed/invoiced jobs only, using the REAL client-charge
  // function (fixed job price → property rate → job-type price). No markup proxy.
  const completedToday = todayJobsRaw.filter((j) =>
    COMPLETED_STATUSES.includes(j.status),
  );
  let revenueToday = 0;
  let revenueRateMissingCount = 0;
  if (completedToday.length > 0) {
    const propertyIds = Array.from(new Set(completedToday.map((j) => j.propertyId)));
    const [propertyRateRows, priceBookRows] = await Promise.all([
      db.propertyClientRate
        .findMany({
          where: { propertyId: { in: propertyIds }, isActive: true },
          select: { propertyId: true, jobType: true, baseCharge: true, defaultDescription: true },
        })
        .catch(() => [] as ClientChargeRates["propertyRates"]),
      db.priceBook
        .findMany({ where: { isActive: true }, select: { jobType: true, baseRate: true } })
        .catch(() => [] as ClientChargeRates["priceBook"]),
    ]);
    const rates: ClientChargeRates = {
      propertyRates: propertyRateRows ?? [],
      priceBook: priceBookRows ?? [],
    };
    for (const job of completedToday) {
      const charge = computeClientCharge(
        { jobType: job.jobType, propertyId: job.propertyId, fixedPrice: job.fixedPrice },
        rates,
      );
      if (charge.amount == null) {
        revenueRateMissingCount += 1;
      } else {
        revenueToday += charge.amount;
      }
    }
    revenueToday = Number(revenueToday.toFixed(2));
  }
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
      revenueRateMissingCount,
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
