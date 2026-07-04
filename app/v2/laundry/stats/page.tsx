import { toZonedTime } from "date-fns-tz";
import { LaundryStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ECard, ECardBody, ECardHeader, ECardTitle, EEmptyState, EPageHeader, EStatCard, EThread } from "@/components/v2/ui/primitives";

export const metadata = { title: "Stats · Estate laundry" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

async function getStats() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);

  const [weekTotal, deliveredWeek, inTransit, flagged, deliveredTasks] = await Promise.all([
    db.laundryTask.count({ where: { createdAt: { gte: weekStart } } }).catch(() => 0),
    db.laundryTask.count({ where: { droppedAt: { gte: weekStart } } }).catch(() => 0),
    db.laundryTask.count({ where: { status: LaundryStatus.PICKED_UP } }).catch(() => 0),
    db.laundryTask.count({ where: { status: LaundryStatus.FLAGGED } }).catch(() => 0),
    db.laundryTask
      .findMany({
        where: { droppedAt: { gte: weekStart } },
        select: { bagWeightKg: true, property: { select: { name: true, suburb: true } } },
        take: 200,
      })
      .catch(() => [] as Array<{ bagWeightKg: number | null; property: { name: string | null; suburb: string | null } | null }>),
  ]);

  // Aggregate delivered loads + weight by property.
  const byProperty = new Map<string, { loads: number; kg: number }>();
  for (const t of deliveredTasks) {
    const name = t.property?.name ?? "Property";
    const suburb = t.property?.suburb ?? "";
    const key = suburb ? `${name}, ${suburb}` : name;
    const prev = byProperty.get(key) ?? { loads: 0, kg: 0 };
    byProperty.set(key, { loads: prev.loads + 1, kg: prev.kg + (t.bagWeightKg ?? 0) });
  }
  const rows = Array.from(byProperty.entries()).sort((a, b) => b[1].loads - a[1].loads).slice(0, 8);

  return { weekTotal, deliveredWeek, inTransit, flagged, rows };
}

export default async function LaundryStatsPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const { weekTotal, deliveredWeek, inTransit, flagged, rows } = await getStats();

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Performance" title="Stats" description="Throughput over the last 7 days." />
      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Loads · week" value={String(weekTotal)} delta="created" deltaTone="neutral" />
        <EStatCard label="Delivered · week" value={String(deliveredWeek)} delta="dropped off" deltaTone="neutral" />
        <EStatCard label="In transit" value={String(inTransit)} delta="picked up" deltaTone="neutral" />
        <EStatCard label="Flagged" value={String(flagged)} delta="needs attention" deltaTone="neutral" />
      </section>
      <ECard>
        <ECardHeader><ECardTitle>Delivered by property · 7 days</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {rows.length === 0 ? (
            <EEmptyState eyebrow="Quiet" title="No deliveries yet" description="Nothing has been dropped off in the last 7 days." />
          ) : (
            rows.map(([name, agg], i) => (
              <div key={name}>
                {i > 0 ? <EThread className="my-1" /> : null}
                <div className="flex items-center justify-between gap-2 py-2">
                  <p className="text-[0.875rem] font-medium">{name}</p>
                  <div className="flex items-center gap-4">
                    <span className="e-numeral text-[0.9375rem]">{agg.loads} {agg.loads === 1 ? "load" : "loads"}</span>
                    {agg.kg > 0 ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{agg.kg.toFixed(1)} kg</span> : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </ECardBody>
      </ECard>
    </div>
  );
}
