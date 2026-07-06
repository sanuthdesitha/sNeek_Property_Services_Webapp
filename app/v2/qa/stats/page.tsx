import { toZonedTime } from "date-fns-tz";
import { QaAssignmentStatus, QaReworkTransferStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ECard, ECardBody, ECardHeader, ECardTitle, EEmptyState, EPageHeader, EStatCard, EThread } from "@/components/v2/ui/primitives";

export const metadata = { title: "Stats · Estate QA" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

async function getStats() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);

  const [completedWeek, reworkWeek, openNow, inProgress, reworkRows] = await Promise.all([
    db.qaAssignment.count({ where: { status: QaAssignmentStatus.COMPLETED, completedAt: { gte: weekStart } } }).catch(() => 0),
    db.qaReworkTransfer.count({ where: { createdAt: { gte: weekStart } } }).catch(() => 0),
    db.qaAssignment.count({ where: { status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED] } } }).catch(() => 0),
    db.qaAssignment.count({ where: { status: QaAssignmentStatus.IN_PROGRESS } }).catch(() => 0),
    db.qaReworkTransfer
      .findMany({
        where: { createdAt: { gte: weekStart } },
        select: { status: true, cleaner: { select: { name: true } } },
        take: 200,
      })
      .catch(() => [] as Array<{ status: QaReworkTransferStatus; cleaner: { name: string | null } | null }>),
  ]);

  // Rework counts by cleaner over the last 7 days.
  const byCleaner = new Map<string, number>();
  for (const r of reworkRows) {
    const name = r.cleaner?.name ?? "Unassigned";
    byCleaner.set(name, (byCleaner.get(name) ?? 0) + 1);
  }
  const rows = Array.from(byCleaner.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const total = completedWeek + reworkWeek;
  const passRate = total > 0 ? Math.round((completedWeek / total) * 100) : null;

  return { completedWeek, reworkWeek, openNow, inProgress, rows, passRate };
}

export default async function QaStatsPage() {
  await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
  const { completedWeek, reworkWeek, openNow, inProgress, rows, passRate } = await getStats();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Performance" title="Stats" description="Quality across the team, last 7 days." />
      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Reviews · week" value={String(completedWeek)} delta="completed" deltaTone="neutral" />
        <EStatCard label="Rework · week" value={String(reworkWeek)} delta="flagged" deltaTone="neutral" />
        <EStatCard label="Pass rate" value={passRate === null ? "—" : `${passRate}%`} delta="reviews vs rework" deltaTone="neutral" />
        <EStatCard label="Open now" value={String(openNow + inProgress)} delta={`${inProgress} in progress`} deltaTone="neutral" />
      </section>
      <ECard>
        <ECardHeader><ECardTitle>Rework by cleaner · 7 days</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {rows.length === 0 ? (
            <EEmptyState eyebrow="All clear" title="No rework this week" description="Every clean passed inspection." />
          ) : (
            rows.map(([name, count], i) => (
              <div key={name}>
                {i > 0 ? <EThread className="my-1" /> : null}
                <div className="flex items-center justify-between gap-2 py-2">
                  <p className="text-[0.875rem] font-medium">{name}</p>
                  <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{count} {count === 1 ? "rework" : "reworks"}</span>
                </div>
              </div>
            ))
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
