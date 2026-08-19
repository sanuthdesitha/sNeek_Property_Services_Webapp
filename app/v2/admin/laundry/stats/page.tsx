// ESTATE — Laundry statistics (native v2 port of app/admin/laundry/stats).
//
// Same question as v1: how much laundry moved, how fast did it come back, and
// what is sitting at the laundromat right now. Two things changed in the port.
//
// 1. Every bucket is an Australia/Sydney calendar day. The rules live in
//    lib/laundry/ops-stats.ts with tests, because v1 computed them with
//    date-fns startOfWeek/endOfDay — which read the SERVER's timezone and, on a
//    UTC host, forgave a whole extra Sydney morning on the on-time figure.
// 2. No @/components/charts and no @/components/admin: KPIs are EStatCard and
//    the bars are the native Estate substitutes, matching /v2/admin/forms/stats.

import Link from "next/link";
import { Role } from "@prisma/client";
import { AlertTriangle, ArrowLeft, Clock, Package, Shirt, Timer } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { EAlert, EButton, ECard, EPageHeader, EStatCard } from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import { EBar, EColumnChart } from "@/components/v2/admin/forms/management/estate-stats-bars";
import {
  buildLaundryOpsStats,
  laundryWindowStartKey,
  type LaundryStatsTask,
} from "@/lib/laundry/ops-stats";
import { addDaysToKey, sydneyDateKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";

export const metadata = { title: "Laundry statistics · Estate admin" };
export const dynamic = "force-dynamic";

const TREND_WEEKS = 8;
const LEADERBOARD_SIZE = 10;

const fmtMoney = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 2,
});

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

/** "3 Aug" from a yyyy-MM-dd key, without re-entering a timezone. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export default async function EstateLaundryStatsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();
  const maxOutdoorDays = settings.laundryOperations?.maxOutdoorDays ?? 3;

  const todayKey = sydneyTodayKey();
  const windowStart = sydneyDayStart(laundryWindowStartKey(todayKey, TREND_WEEKS));

  // The PICKED_UP arm is deliberately unbounded: a bag that went out three
  // months ago and never came back is exactly what "at laundry now" must show.
  const tasks = (await db.laundryTask.findMany({
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
      dropoffCostAud: true,
      property: { select: { id: true, name: true, suburb: true } },
    },
  })) as LaundryStatsTask[];

  const stats = buildLaundryOpsStats(tasks, {
    todayKey,
    maxOutdoorDays,
    trendWeeks: TREND_WEEKS,
    leaderboardSize: LEADERBOARD_SIZE,
  });

  const leaderboardMax = Math.max(1, ...stats.leaderboard.map((p) => p.count));
  const onTimeRate = stats.droppedCount > 0 ? stats.onTimeCount / stats.droppedCount : null;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Laundry statistics"
        description={`Volumes, turnaround and reliability over the last ${TREND_WEEKS} weeks, by Sydney calendar week.`}
        actions={
          <EButton asChild variant="ghost" size="sm">
            <Link href="/v2/admin/laundry">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              Back to planner
            </Link>
          </EButton>
        }
      />

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <EStatCard
          label="Dropped this month"
          value={stats.monthDroppedCount}
          delta={
            stats.monthCostAud > 0
              ? `${fmtMoney.format(stats.monthCostAud)} in drop-off cost`
              : "no cost recorded"
          }
          deltaTone="neutral"
          icon={<Shirt className="h-4 w-4" />}
        />
        <EStatCard
          label="On time"
          value={pct(stats.onTimeCount, stats.droppedCount)}
          delta={`${stats.onTimeCount}/${stats.droppedCount} back by the due day`}
          deltaTone={onTimeRate !== null && onTimeRate < 0.9 ? "danger" : "success"}
          icon={<Clock className="h-4 w-4" />}
        />
        <EStatCard
          label="Average turnaround"
          value={
            stats.avgTurnaroundHours !== null ? `${stats.avgTurnaroundHours.toFixed(1)} h` : "—"
          }
          delta="pickup → drop-off"
          deltaTone="neutral"
          icon={<Timer className="h-4 w-4" />}
        />
        <EStatCard
          label="At laundry now"
          value={stats.outstandingCount}
          delta={
            stats.overdue.length > 0
              ? `${stats.overdue.length} overdue past ${maxOutdoorDays} days`
              : "all within the window"
          }
          deltaTone={stats.overdue.length > 0 ? "danger" : "success"}
          icon={<Package className="h-4 w-4" />}
        />
      </section>

      {stats.overdue.length > 0 ? (
        <EAlert
          tone="warning"
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Overdue at the laundromat — more than {maxOutdoorDays} days out
            </span>
          }
        >
          <ul className="space-y-1">
            {stats.overdue.map(({ task, pickedUpKey, daysOut }) => (
              <li key={task.id} className="text-[0.8125rem]">
                <span className="font-medium">{task.property?.name ?? "Unknown property"}</span>
                <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">
                  {" "}
                  — picked up {shortDate(pickedUpKey)} ({daysOut} days ago) · due back{" "}
                  {shortDate(sydneyDateKey(new Date(task.dropoffDate)))}
                </span>
              </li>
            ))}
          </ul>
        </EAlert>
      ) : null}

      <EColumnChart
        title={`Dropped per week — last ${TREND_WEEKS} weeks`}
        subtitle="Bags returned to the property, by the Sydney week they came back"
        data={stats.weeks.map((w) => ({ label: shortDate(w.key), count: w.dropped }))}
      />

      <ECard className="p-5">
        <div className="mb-4">
          <h3 className="text-[1rem] font-semibold tracking-[-0.01em] text-[hsl(var(--e-foreground))]">
            Week by week
          </h3>
          <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Flagged and skipped are counted against the week the pickup was scheduled, not the week
            they were noticed.
          </p>
        </div>
        <ETableShell
          headers={[
            { label: "Week" },
            { label: "Scheduled", align: "right" },
            { label: "Picked up", align: "right" },
            { label: "Dropped", align: "right" },
            { label: "Flagged", align: "right" },
            { label: "Skipped", align: "right" },
            { label: "Cost", align: "right" },
          ]}
        >
          {stats.weeks.map((week) => (
            <tr key={week.key}>
              <td className="whitespace-nowrap px-4 py-3 font-medium text-[hsl(var(--e-foreground))]">
                {shortDate(week.key)} – {shortDate(addDaysToKey(week.key, 6))}
              </td>
              <td className="e-tnum px-4 py-3 text-right">{week.scheduled}</td>
              <td className="e-tnum px-4 py-3 text-right">{week.pickedUp}</td>
              <td className="e-tnum px-4 py-3 text-right">{week.dropped}</td>
              <td className="e-tnum px-4 py-3 text-right">
                {week.flagged > 0 ? (
                  <span className="text-[hsl(var(--e-danger))]">{week.flagged}</span>
                ) : (
                  0
                )}
              </td>
              <td className="e-tnum px-4 py-3 text-right">{week.skipped}</td>
              <td className="e-tnum px-4 py-3 text-right">
                {week.costAud > 0 ? fmtMoney.format(week.costAud) : "—"}
              </td>
            </tr>
          ))}
        </ETableShell>
      </ECard>

      <ECard className="p-5">
        <div className="mb-4">
          <h3 className="text-[1rem] font-semibold tracking-[-0.01em] text-[hsl(var(--e-foreground))]">
            Top properties by laundry volume
          </h3>
          <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Total tasks in the window · top {LEADERBOARD_SIZE}
          </p>
        </div>
        {stats.leaderboard.length === 0 ? (
          <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            No laundry tasks in the window.
          </p>
        ) : (
          <div className="space-y-2.5">
            {stats.leaderboard.map((p) => (
              <div key={p.propertyId} className="flex items-center gap-3">
                <span
                  className="w-48 shrink-0 truncate text-[0.8125rem] text-[hsl(var(--e-text-secondary))]"
                  title={p.label}
                >
                  {p.label}
                </span>
                <EBar value={p.count} max={leaderboardMax} />
                <span className="e-tnum w-16 shrink-0 text-right text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {p.dropped}/{p.count}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          Figures read “dropped / total” — a gap means bags are still out.
        </p>
      </ECard>
    </div>
  );
}
