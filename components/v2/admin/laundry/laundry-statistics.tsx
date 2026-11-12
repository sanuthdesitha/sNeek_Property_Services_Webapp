"use client";

/**
 * Statistics tab: the content of the former /v2/admin/laundry/stats page (same
 * figures, same Sydney-week rules) plus the team metrics section. Loaded only
 * when the tab opens; no polling.
 */
import * as React from "react";
import { AlertTriangle, Clock, Package, Shirt, Timer } from "lucide-react";
import { EAlert, EButton, ECard, EStatCard } from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import { EBar, EColumnChart } from "@/components/v2/admin/forms/management/estate-stats-bars";
import { addDaysToKey, sydneyDateKey } from "@/lib/time/sydney-range";
import type { LaundryStatsPayload } from "@/lib/laundry/stats-load";
import { LaundryTeamMetricsPanel } from "./laundry-team-metrics";

const fmtMoney = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function pct(numerator: number, denominator: number): string {
  return denominator === 0 ? "—" : `${Math.round((numerator / denominator) * 100)}%`;
}

function useLaundryStats() {
  const [data, setData] = React.useState<LaundryStatsPayload | null>(null);
  const [error, setError] = React.useState("");
  const [nonce, setNonce] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setError("");
    void (async () => {
      try {
        const response = await fetch("/api/admin/laundry/stats", { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => ({}))) as LaundryStatsPayload & { error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok || !body.stats) throw new Error(body.error || "Could not load laundry statistics.");
        setData(body);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load laundry statistics.");
      }
    })();
    return () => controller.abort();
  }, [nonce]);
  return { data, error, retry: () => setNonce((n) => n + 1) };
}

export function LaundryStatistics() {
  const { data, error, retry } = useLaundryStats();
  if (error) {
    return (
      <div role="alert" className="space-y-2 text-[0.875rem]">
        <p className="text-[hsl(var(--e-danger))]">{error}</p>
        <EButton size="sm" variant="outline" onClick={retry}>Retry</EButton>
      </div>
    );
  }
  if (!data) return <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading statistics…</p>;
  const { stats, maxOutdoorDays, trendWeeks, leaderboardSize } = data;
  const leaderboardMax = Math.max(1, ...stats.leaderboard.map((p) => p.count));
  const onTimeRate = stats.droppedCount > 0 ? stats.onTimeCount / stats.droppedCount : null;

  return (
    <section aria-labelledby="laundry-stats-title" className="space-y-6">
      <div>
        <h2 id="laundry-stats-title" className="text-[1.0625rem] font-semibold">Laundry statistics</h2>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Volumes, turnaround and reliability over the last {trendWeeks} weeks, by Sydney calendar week.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <EStatCard label="Dropped this month" value={stats.monthDroppedCount} delta={stats.monthCostAud > 0 ? `${fmtMoney.format(stats.monthCostAud)} in drop-off cost` : "no cost recorded"} deltaTone="neutral" icon={<Shirt className="h-4 w-4" />} />
        <EStatCard label="On time" value={pct(stats.onTimeCount, stats.droppedCount)} delta={`${stats.onTimeCount}/${stats.droppedCount} back by the due day`} deltaTone={onTimeRate !== null && onTimeRate < 0.9 ? "danger" : "success"} icon={<Clock className="h-4 w-4" />} />
        <EStatCard label="Average turnaround" value={stats.avgTurnaroundHours !== null ? `${stats.avgTurnaroundHours.toFixed(1)} h` : "—"} delta="pickup → drop-off" deltaTone="neutral" icon={<Timer className="h-4 w-4" />} />
        <EStatCard label="At laundry now" value={stats.outstandingCount} delta={stats.overdue.length > 0 ? `${stats.overdue.length} overdue past ${maxOutdoorDays} days` : "all within the window"} deltaTone={stats.overdue.length > 0 ? "danger" : "success"} icon={<Package className="h-4 w-4" />} />
      </div>

      {stats.overdue.length > 0 ? (
        <EAlert tone="warning" title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Overdue at the laundromat — more than {maxOutdoorDays} days out</span>}>
          <ul className="space-y-1">
            {stats.overdue.map(({ task, pickedUpKey, daysOut }) => (
              <li key={task.id} className="text-[0.8125rem]">
                <span className="font-medium">{task.property?.name ?? "Unknown property"}</span>
                <span className="e-tnum text-[hsl(var(--e-muted-foreground))]"> — picked up {shortDate(pickedUpKey)} ({daysOut} days ago) · due back {shortDate(sydneyDateKey(new Date(task.dropoffDate)))}</span>
              </li>
            ))}
          </ul>
        </EAlert>
      ) : null}

      <EColumnChart title={`Dropped per week — last ${trendWeeks} weeks`} subtitle="Bags returned to the property, by the Sydney week they came back" data={stats.weeks.map((w) => ({ label: shortDate(w.key), count: w.dropped }))} />

      <ECard className="p-5">
        <h3 className="text-[1rem] font-semibold">Week by week</h3>
        <p className="mb-4 mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Flagged and skipped are counted against the week the pickup was scheduled, not the week they were noticed.</p>
        <ETableShell headers={[{ label: "Week" }, { label: "Scheduled", align: "right" }, { label: "Picked up", align: "right" }, { label: "Dropped", align: "right" }, { label: "Flagged", align: "right" }, { label: "Skipped", align: "right" }, { label: "Cost", align: "right" }]}>
          {stats.weeks.map((week) => (
            <tr key={week.key}>
              <td className="whitespace-nowrap px-4 py-3 font-medium">{shortDate(week.key)} – {shortDate(addDaysToKey(week.key, 6))}</td>
              <td className="e-tnum px-4 py-3 text-right">{week.scheduled}</td>
              <td className="e-tnum px-4 py-3 text-right">{week.pickedUp}</td>
              <td className="e-tnum px-4 py-3 text-right">{week.dropped}</td>
              <td className="e-tnum px-4 py-3 text-right">{week.flagged > 0 ? <span className="text-[hsl(var(--e-danger))]">{week.flagged}</span> : 0}</td>
              <td className="e-tnum px-4 py-3 text-right">{week.skipped}</td>
              <td className="e-tnum px-4 py-3 text-right">{week.costAud > 0 ? fmtMoney.format(week.costAud) : "—"}</td>
            </tr>
          ))}
        </ETableShell>
      </ECard>

      <ECard className="p-5">
        <h3 className="text-[1rem] font-semibold">Top properties by laundry volume</h3>
        <p className="mb-4 mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Total tasks in the window · top {leaderboardSize}</p>
        {stats.leaderboard.length === 0 ? (
          <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No laundry tasks in the window.</p>
        ) : (
          <div className="space-y-2.5">
            {stats.leaderboard.map((p) => (
              <div key={p.propertyId} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-[0.8125rem] text-[hsl(var(--e-text-secondary))] sm:w-48" title={p.label}>{p.label}</span>
                <EBar value={p.count} max={leaderboardMax} />
                <span className="e-tnum w-16 shrink-0 text-right text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{p.dropped}/{p.count}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[0.75rem] text-[hsl(var(--e-text-faint))]">Figures read “dropped / total” — a gap means bags are still out.</p>
      </ECard>

      <LaundryTeamMetricsPanel />
    </section>
  );
}
