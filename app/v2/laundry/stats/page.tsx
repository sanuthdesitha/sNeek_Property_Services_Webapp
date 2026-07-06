import { toZonedTime } from "date-fns-tz";
import { LaundryStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
  EStatCard,
  EThread,
} from "@/components/v2/ui/primitives";

export const metadata = { title: "Stats · Estate laundry" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";
const DAY = 86_400_000;

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

const STATUS_META: Array<{ status: LaundryStatus; label: string; tone: Tone }> = [
  { status: LaundryStatus.PENDING, label: "Pending", tone: "neutral" },
  { status: LaundryStatus.CONFIRMED, label: "Awaiting pickup", tone: "primary" },
  { status: LaundryStatus.PICKED_UP, label: "At laundry", tone: "info" },
  { status: LaundryStatus.DROPPED, label: "Returned", tone: "success" },
  { status: LaundryStatus.FLAGGED, label: "Flagged", tone: "danger" },
  { status: LaundryStatus.SKIPPED_PICKUP, label: "Skipped", tone: "warning" },
];

const TONE_VAR: Record<Tone, string> = {
  neutral: "--e-muted-foreground",
  primary: "--e-primary",
  info: "--e-info",
  success: "--e-success",
  warning: "--e-warning",
  danger: "--e-danger",
};

async function getStats() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const todayStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + DAY);
  const dayAfterTomorrow = new Date(todayStart.getTime() + 2 * DAY);
  const weekStart = new Date(todayStart.getTime() - 6 * DAY);

  const [
    weekTotal,
    deliveredWeek,
    statusGroups,
    pickupsDueNow,
    overdueDropoffs,
    waitingCleaner,
    revenueWeek,
    deliveredTasks,
  ] = await Promise.all([
    db.laundryTask.count({ where: { createdAt: { gte: weekStart } } }).catch(() => 0),
    db.laundryTask.count({ where: { droppedAt: { gte: weekStart } } }).catch(() => 0),
    db.laundryTask
      .groupBy({ by: ["status"], _count: { _all: true }, where: { noPickupRequired: false } })
      .catch(() => [] as Array<{ status: LaundryStatus; _count: { _all: number } }>),
    // Immediate attention — same buckets as the v1 planner's panel.
    db.laundryTask
      .count({ where: { status: LaundryStatus.CONFIRMED, pickupDate: { lt: dayAfterTomorrow } } })
      .catch(() => 0),
    db.laundryTask
      .count({ where: { status: LaundryStatus.PICKED_UP, dropoffDate: { lt: todayStart } } })
      .catch(() => 0),
    db.laundryTask
      .count({ where: { status: LaundryStatus.PENDING, pickupDate: { lte: tomorrowStart } } })
      .catch(() => 0),
    db.laundryTask
      .aggregate({ _sum: { dropoffCostAud: true }, where: { droppedAt: { gte: weekStart } } })
      .then((r) => r._sum.dropoffCostAud ?? 0)
      .catch(() => 0),
    db.laundryTask
      .findMany({
        where: { droppedAt: { gte: weekStart } },
        select: { bagWeightKg: true, dropoffCostAud: true, property: { select: { name: true, suburb: true } } },
        take: 200,
      })
      .catch(
        () =>
          [] as Array<{
            bagWeightKg: number | null;
            dropoffCostAud: number | null;
            property: { name: string | null; suburb: string | null } | null;
          }>
      ),
  ]);

  const statusCounts = new Map<LaundryStatus, number>();
  for (const g of statusGroups) statusCounts.set(g.status, g._count._all);
  const statusTotal = Array.from(statusCounts.values()).reduce((s, n) => s + n, 0);
  const flagged = statusCounts.get(LaundryStatus.FLAGGED) ?? 0;
  const skipped = statusCounts.get(LaundryStatus.SKIPPED_PICKUP) ?? 0;

  // Delivered loads + weight + cost by property (7 days).
  const byProperty = new Map<string, { loads: number; kg: number; cost: number }>();
  for (const t of deliveredTasks) {
    const name = t.property?.name ?? "Property";
    const suburb = t.property?.suburb ?? "";
    const key = suburb ? `${name}, ${suburb}` : name;
    const prev = byProperty.get(key) ?? { loads: 0, kg: 0, cost: 0 };
    byProperty.set(key, {
      loads: prev.loads + 1,
      kg: prev.kg + (t.bagWeightKg ?? 0),
      cost: prev.cost + (t.dropoffCostAud ?? 0),
    });
  }
  const rows = Array.from(byProperty.entries())
    .sort((a, b) => b[1].loads - a[1].loads)
    .slice(0, 8);

  return {
    weekTotal,
    deliveredWeek,
    statusCounts,
    statusTotal,
    flagged,
    skipped,
    pickupsDueNow,
    overdueDropoffs,
    waitingCleaner,
    revenueWeek,
    rows,
  };
}

export default async function LaundryStatsPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  const {
    weekTotal,
    deliveredWeek,
    statusCounts,
    statusTotal,
    flagged,
    skipped,
    pickupsDueNow,
    overdueDropoffs,
    waitingCleaner,
    revenueWeek,
    rows,
  } = await getStats();

  const attention = [
    { id: "pickups-now", label: "Pickups due now", desc: "Confirmed pickups scheduled today/tomorrow.", count: pickupsDueNow, tone: "danger" as Tone },
    { id: "overdue-drops", label: "Overdue drop-offs", desc: "Picked-up loads past their planned return date.", count: overdueDropoffs, tone: "danger" as Tone },
    { id: "flagged", label: "Flagged tasks", desc: "Flagged for manual handling.", count: flagged, tone: "warning" as Tone },
    { id: "skipped", label: "Skipped pickups", desc: "No-pickup-required per cleaner/admin instructions.", count: skipped, tone: "warning" as Tone },
    { id: "waiting-cleaner", label: "Waiting cleaner confirmation", desc: "Upcoming pickups not yet marked laundry-ready.", count: waitingCleaner, tone: "warning" as Tone },
  ];

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Performance" title="Stats" description="Throughput, status mix and attention items." />

      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Loads · week" value={String(weekTotal)} delta="created" deltaTone="neutral" />
        <EStatCard label="Delivered · week" value={String(deliveredWeek)} delta="dropped off" deltaTone="neutral" />
        <EStatCard
          label="Revenue tracked · week"
          value={`$${revenueWeek.toFixed(0)}`}
          delta="return charges"
          deltaTone="neutral"
        />
        <EStatCard
          label="Flagged"
          value={String(flagged)}
          delta="needs attention"
          deltaTone={flagged > 0 ? "danger" : "neutral"}
        />
      </section>

      {/* Immediate attention — mirror of the v1 planner panel */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Immediate attention</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-1">
          {attention.map((a, i) => (
            <div key={a.id}>
              {i > 0 ? <EThread className="my-1" /> : null}
              <div className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-medium">{a.label}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{a.desc}</p>
                </div>
                <span
                  className="e-numeral text-[1.0625rem]"
                  style={{ color: a.count > 0 ? `hsl(var(${TONE_VAR[a.tone]}))` : "hsl(var(--e-text-faint))" }}
                >
                  {a.count}
                </span>
              </div>
            </div>
          ))}
        </ECardBody>
      </ECard>

      {/* Status mix — the planner's donut, as Estate bars */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Status mix</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-3">
          {statusTotal === 0 ? (
            <EEmptyState eyebrow="Quiet" title="No tasks" description="No laundry tasks in the pipeline right now." />
          ) : (
            STATUS_META.map((s) => {
              const count = statusCounts.get(s.status) ?? 0;
              if (count === 0) return null;
              const pct = Math.round((count / statusTotal) * 100);
              return (
                <div key={s.status} className="space-y-1">
                  <div className="flex items-center justify-between text-[0.8125rem]">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-[hsl(var(--e-muted-foreground))]">
                      {count} · {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--e-surface-sunken))]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: `hsl(var(${TONE_VAR[s.tone]}))` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader>
          <ECardTitle>Delivered by property · 7 days</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-1">
          {rows.length === 0 ? (
            <EEmptyState eyebrow="Quiet" title="No deliveries yet" description="Nothing has been dropped off in the last 7 days." />
          ) : (
            rows.map(([name, agg], i) => (
              <div key={name}>
                {i > 0 ? <EThread className="my-1" /> : null}
                <div className="flex items-center justify-between gap-2 py-2">
                  <p className="min-w-0 truncate text-[0.875rem] font-medium">{name}</p>
                  <div className="flex flex-shrink-0 items-center gap-4">
                    <span className="e-numeral text-[0.9375rem]">
                      {agg.loads} {agg.loads === 1 ? "load" : "loads"}
                    </span>
                    {agg.kg > 0 ? (
                      <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{agg.kg.toFixed(1)} kg</span>
                    ) : null}
                    {agg.cost > 0 ? (
                      <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">${agg.cost.toFixed(0)}</span>
                    ) : null}
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
