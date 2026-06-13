import Link from "next/link";
import { Role } from "@prisma/client";
import { addDays, differenceInCalendarDays, endOfDay, format, startOfWeek } from "date-fns";
import { AlertTriangle, ArrowLeft, BarChart3, Clock, Package, Shirt, Timer, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const TREND_WEEKS = 8;

type WeekRow = {
  label: string;
  start: Date;
  scheduled: number;
  pickedUp: number;
  dropped: number;
  flagged: number;
  skipped: number;
  costAud: number;
};

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function IntensityBar({ value, max, tone = "bg-primary" }: { value: number; max: number; tone?: string }) {
  const width = max > 0 ? Math.max(value > 0 ? 6 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-right tabular-nums">{value}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/60">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "text-primary bg-primary/10",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone} [&>svg]:h-5 [&>svg]:w-5`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function LaundryStatsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();
  const maxOutdoorDays = settings.laundryOperations?.maxOutdoorDays ?? 3;

  const now = new Date();
  const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const windowStart = addDays(thisWeekStart, -7 * (TREND_WEEKS - 1));

  const tasks = await db.laundryTask.findMany({
    where: {
      OR: [
        { pickupDate: { gte: windowStart } },
        { droppedAt: { gte: windowStart } },
        { status: "PICKED_UP" },
      ],
    },
    select: {
      id: true,
      status: true,
      pickupDate: true,
      dropoffDate: true,
      pickedUpAt: true,
      droppedAt: true,
      flagReason: true,
      bagWeightKg: true,
      dropoffCostAud: true,
      property: { select: { id: true, name: true, suburb: true } },
    },
  });

  // ── Weekly trend (last 8 weeks) ─────────────────────────────────────────
  const weeks: WeekRow[] = [];
  for (let i = 0; i < TREND_WEEKS; i++) {
    const start = addDays(windowStart, i * 7);
    const end = addDays(start, 7);
    const inWeek = (d: Date | string | null | undefined) => {
      if (!d) return false;
      const t = new Date(d);
      return t >= start && t < end;
    };
    const scheduledTasks = tasks.filter((t) => inWeek(t.pickupDate));
    weeks.push({
      label: `${format(start, "d MMM")} – ${format(addDays(start, 6), "d MMM")}`,
      start,
      scheduled: scheduledTasks.length,
      pickedUp: tasks.filter((t) => inWeek(t.pickedUpAt)).length,
      dropped: tasks.filter((t) => inWeek(t.droppedAt)).length,
      flagged: scheduledTasks.filter((t) => t.status === "FLAGGED" || t.flagReason).length,
      skipped: scheduledTasks.filter((t) => t.status === "SKIPPED_PICKUP").length,
      costAud: tasks
        .filter((t) => inWeek(t.droppedAt))
        .reduce((sum, t) => sum + (t.dropoffCostAud ?? 0), 0),
    });
  }
  const maxWeekly = Math.max(1, ...weeks.map((w) => Math.max(w.pickedUp, w.dropped, w.scheduled)));

  // ── Headline KPIs over the whole window ─────────────────────────────────
  const droppedTasks = tasks.filter((t) => t.droppedAt);
  const onTime = droppedTasks.filter(
    (t) => t.droppedAt && new Date(t.droppedAt) <= endOfDay(new Date(t.dropoffDate)),
  );
  const turnaroundHours = droppedTasks
    .filter((t) => t.pickedUpAt && t.droppedAt)
    .map((t) => (new Date(t.droppedAt as Date).getTime() - new Date(t.pickedUpAt as Date).getTime()) / 3_600_000)
    .filter((h) => h >= 0);
  const avgTurnaround =
    turnaroundHours.length > 0
      ? turnaroundHours.reduce((a, b) => a + b, 0) / turnaroundHours.length
      : null;

  const outstanding = tasks.filter((t) => t.status === "PICKED_UP");
  const overdueAtLaundry = outstanding.filter(
    (t) => t.pickedUpAt && differenceInCalendarDays(now, new Date(t.pickedUpAt)) > maxOutdoorDays,
  );

  const thisMonthKey = format(now, "yyyy-MM");
  const monthDropped = droppedTasks.filter(
    (t) => t.droppedAt && format(new Date(t.droppedAt), "yyyy-MM") === thisMonthKey,
  );
  const monthCost = monthDropped.reduce((sum, t) => sum + (t.dropoffCostAud ?? 0), 0);

  // ── Per-property leaderboard (top 10 by volume in window) ───────────────
  const byProperty = new Map<string, { name: string; suburb: string | null; count: number; dropped: number }>();
  for (const t of tasks) {
    if (!t.property) continue;
    const entry = byProperty.get(t.property.id) ?? {
      name: t.property.name,
      suburb: t.property.suburb,
      count: 0,
      dropped: 0,
    };
    entry.count += 1;
    if (t.droppedAt) entry.dropped += 1;
    byProperty.set(t.property.id, entry);
  }
  const leaderboard = Array.from(byProperty.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const maxPropertyCount = Math.max(1, ...leaderboard.map((p) => p.count));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<BarChart3 />}
        title="Laundry statistics"
        description={`Volumes, turnaround, and reliability over the last ${TREND_WEEKS} weeks.`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/laundry">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to planner
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Shirt />}
          label="Dropped this month"
          value={monthDropped.length}
          hint={monthCost > 0 ? `$${monthCost.toFixed(2)} drop-off cost` : undefined}
        />
        <StatCard
          icon={<Clock />}
          label="On-time return rate"
          value={pct(onTime.length, droppedTasks.length)}
          hint={`${onTime.length} of ${droppedTasks.length} returned by due date`}
          tone="text-success bg-success/10"
        />
        <StatCard
          icon={<Timer />}
          label="Avg turnaround"
          value={avgTurnaround !== null ? `${avgTurnaround.toFixed(1)} h` : "—"}
          hint="Pickup to drop-off"
          tone="text-info bg-info/10"
        />
        <StatCard
          icon={<Package />}
          label="At laundry now"
          value={outstanding.length}
          hint={
            overdueAtLaundry.length > 0
              ? `${overdueAtLaundry.length} out longer than ${maxOutdoorDays} days`
              : "All within turnaround window"
          }
          tone={overdueAtLaundry.length > 0 ? "text-warning bg-warning/10" : "text-primary bg-primary/10"}
        />
      </div>

      {overdueAtLaundry.length > 0 ? (
        <Card className="border-warning/50 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-warning">
              <AlertTriangle className="h-4 w-4" />
              Overdue at the laundromat (&gt; {maxOutdoorDays} days)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {overdueAtLaundry.map((t) => (
              <p key={t.id} className="text-sm text-foreground">
                <span className="font-medium">{t.property?.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {" "}
                  — picked up {t.pickedUpAt ? format(new Date(t.pickedUpAt), "d MMM HH:mm") : "?"} · due back{" "}
                  {format(new Date(t.dropoffDate), "d MMM")}
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-primary" />
            Weekly trend — last {TREND_WEEKS} weeks
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Week</th>
                  <th className="px-4 py-2 font-medium">Scheduled</th>
                  <th className="px-4 py-2 font-medium">Picked up</th>
                  <th className="px-4 py-2 font-medium">Dropped</th>
                  <th className="px-4 py-2 font-medium text-right">Flagged</th>
                  <th className="px-4 py-2 font-medium text-right">Skipped</th>
                  <th className="px-4 py-2 font-medium text-right">Cost (AUD)</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week.label} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 font-medium text-foreground">{week.label}</td>
                    <td className="min-w-[130px] px-4 py-2 text-muted-foreground">
                      <IntensityBar value={week.scheduled} max={maxWeekly} tone="bg-muted-foreground/50" />
                    </td>
                    <td className="min-w-[130px] px-4 py-2 text-muted-foreground">
                      <IntensityBar value={week.pickedUp} max={maxWeekly} tone="bg-info" />
                    </td>
                    <td className="min-w-[130px] px-4 py-2 text-muted-foreground">
                      <IntensityBar value={week.dropped} max={maxWeekly} tone="bg-success" />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {week.flagged > 0 ? <span className="text-destructive">{week.flagged}</span> : 0}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">{week.skipped}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {week.costAud > 0 ? `$${week.costAud.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <CardTitle className="text-base">Top properties by laundry volume</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {leaderboard.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No laundry tasks in the last {TREND_WEEKS} weeks.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {leaderboard.map((p, index) => (
                <li key={`${p.name}-${index}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                  <span className="w-5 text-right text-xs font-semibold text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {p.name}
                    {p.suburb ? <span className="ml-1.5 font-normal text-muted-foreground">{p.suburb}</span> : null}
                  </span>
                  <div className="flex w-40 items-center gap-2 sm:w-56">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/60">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round((p.count / maxPropertyCount) * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">
                      {p.count} task{p.count === 1 ? "" : "s"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
