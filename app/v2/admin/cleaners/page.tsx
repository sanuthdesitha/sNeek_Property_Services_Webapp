import { JobStatus, PayAdjustmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  getPerformanceMetrics,
  emptyPerformanceMetrics,
  type PerformanceMetrics,
} from "@/lib/workforce/performance";
import {
  EstateCleanersRoster,
  type EstateCleanerRow,
} from "@/components/v2/admin/cleaners/cleaners-roster";
import { EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Cleaners · Estate admin" };
export const dynamic = "force-dynamic";

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.ASSIGNED,
  JobStatus.OFFERED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
];

/** Bounded + time-boxed 30-day metrics so a big team never times out (502). */
async function safeMetrics(userId: string): Promise<PerformanceMetrics> {
  try {
    return await Promise.race([
      getPerformanceMetrics(userId, 30),
      new Promise<PerformanceMetrics>((resolve) =>
        setTimeout(() => resolve(emptyPerformanceMetrics(userId, 30)), 10_000)
      ),
    ]);
  } catch {
    return emptyPerformanceMetrics(userId, 30);
  }
}

export default async function EstateCleanersPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const cleaners = await db.user.findMany({
    where: { role: Role.CLEANER },
    select: { id: true, name: true, email: true, image: true, phone: true, isActive: true, hourlyRate: true, createdAt: true, lastSeenAt: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [payRows, hourRows, activeRows] = await Promise.all([
    db.cleanerPayAdjustment.groupBy({
      by: ["cleanerId"],
      where: { status: PayAdjustmentStatus.APPROVED },
      _sum: { approvedAmount: true },
    }).catch(() => [] as Array<{ cleanerId: string; _sum: { approvedAmount: number | null } }>),
    db.timeLog.groupBy({
      by: ["userId"],
      where: { startedAt: { gte: since30 }, stoppedAt: { not: null } },
      _sum: { durationM: true },
    }).catch(() => [] as Array<{ userId: string; _sum: { durationM: number | null } }>),
    db.jobAssignment.groupBy({
      by: ["userId"],
      where: { removedAt: null, job: { status: { in: ACTIVE_JOB_STATUSES } } },
      _count: { _all: true },
    }).catch(() => [] as Array<{ userId: string; _count: { _all: number } }>),
  ]);

  const payById = new Map(payRows.map((r) => [r.cleanerId, Number(r._sum.approvedAmount ?? 0)]));
  const hoursById = new Map(
    hourRows.map((r) => [r.userId, Math.round(((r._sum.durationM ?? 0) / 60) * 10) / 10])
  );
  const activeById = new Map(activeRows.map((r) => [r.userId, r._count._all]));

  // Metrics with bounded concurrency.
  const metricsById = new Map<string, PerformanceMetrics>();
  const CONCURRENCY = 5;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cleaners.length) }, async () => {
      while (cursor < cleaners.length) {
        const idx = cursor++;
        const c = cleaners[idx];
        metricsById.set(c.id, await safeMetrics(c.id));
      }
    })
  );

  const rows: EstateCleanerRow[] = cleaners.map((c) => {
    const m = metricsById.get(c.id) ?? emptyPerformanceMetrics(c.id, 30);
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      image: c.image,
      phone: c.phone,
      isActive: c.isActive,
      hourlyRate: c.hourlyRate,
      joinedAt: c.createdAt.toISOString(),
      lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
      quality: m.quality.score,
      reliability: m.reliability.onTimePercent,
      attendance: m.attendance.percent,
      rating: m.customerSatisfaction.avgRating,
      docCompliance: m.documentCompliance.percent,
      jobs30d: m.attendance.completedJobs,
      reworks30d: m.reworkRate.reworks,
      hours30d: hoursById.get(c.id) ?? 0,
      activeJobs: activeById.get(c.id) ?? 0,
      outstandingPay: payById.get(c.id) ?? 0,
    };
  });

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Cleaners"
        description="The whole cleaning team — performance, workload, pay and quick actions."
      />
      <EstateCleanersRoster rows={rows} />
    </div>
  );
}
