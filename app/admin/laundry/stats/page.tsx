import Link from "next/link";
import { Role } from "@prisma/client";
import { addDays, differenceInCalendarDays, endOfDay, format, startOfWeek } from "date-fns";
import { AlertTriangle, ArrowLeft, BarChart3, Clock, Package, Shirt, Timer, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard, KpiTile } from "@/components/charts";
import {
  LaundryWeeklyTrend,
  LaundryPropertyLeaderboard,
} from "@/components/admin/laundry-stats-charts";
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
  // Chart-kit series for the weekly trend + a dropped-volume sparkline.
  const weeklyTrend = weeks.map((w) => ({
    week: format(w.start, "d MMM"),
    scheduled: w.scheduled,
    pickedUp: w.pickedUp,
    dropped: w.dropped,
  }));
  const weeklySpark = weeks.map((w) => ({ value: w.dropped }));

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
  const leaderboardData = leaderboard.map((p) => ({
    label: p.suburb ? `${p.name} · ${p.suburb}` : p.name,
    count: p.count,
  }));

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

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiTile
          icon={<Shirt />}
          tone="primary"
          label={
            monthCost > 0
              ? `Dropped this month · $${monthCost.toFixed(0)} cost`
              : "Dropped this month"
          }
          value={monthDropped.length}
          spark={weeklySpark}
        />
        <KpiTile
          icon={<Clock />}
          tone="success"
          label={`On-time · ${onTime.length}/${droppedTasks.length} by due date`}
          value={pct(onTime.length, droppedTasks.length)}
        />
        <KpiTile
          icon={<Timer />}
          tone="info"
          label="Avg turnaround · pickup→drop"
          value={avgTurnaround !== null ? `${avgTurnaround.toFixed(1)} h` : "—"}
        />
        <KpiTile
          icon={<Package />}
          tone={overdueAtLaundry.length > 0 ? "warning" : "primary"}
          label={
            overdueAtLaundry.length > 0
              ? `At laundry now · ${overdueAtLaundry.length} overdue >${maxOutdoorDays}d`
              : "At laundry now · within window"
          }
          value={outstanding.length}
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

      <ChartCard
        title={
          <span className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" />
            Weekly trend — last {TREND_WEEKS} weeks
          </span>
        }
        subtitle="Scheduled, picked up, and dropped volumes per week"
      >
        <LaundryWeeklyTrend data={weeklyTrend} />
        <div className="mt-2 overflow-x-auto px-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 font-medium">Week</th>
                <th className="py-2 font-medium text-right">Flagged</th>
                <th className="py-2 font-medium text-right">Skipped</th>
                <th className="py-2 font-medium text-right">Cost (AUD)</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.label} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap py-2 font-medium text-foreground">{week.label}</td>
                  <td className="py-2 text-right tabular-nums text-foreground">
                    {week.flagged > 0 ? <span className="text-destructive">{week.flagged}</span> : 0}
                  </td>
                  <td className="py-2 text-right tabular-nums text-foreground">{week.skipped}</td>
                  <td className="py-2 text-right tabular-nums text-foreground">
                    {week.costAud > 0 ? `$${week.costAud.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <ChartCard
        title="Top properties by laundry volume"
        subtitle="Total tasks in the window · top 10"
      >
        <LaundryPropertyLeaderboard data={leaderboardData} />
      </ChartCard>
    </div>
  );
}
