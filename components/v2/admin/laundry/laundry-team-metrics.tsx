"use client";

/**
 * Laundry team and supplier accountability, moved from the old Accountability
 * page to Laundry statistics. Reads GET /api/admin/laundry/team-metrics with
 * its own 7 / 30 / 90 day choice (Sydney days). Per-person pickups and drops
 * are attributed to the user who confirmed them; stuck tasks still awaiting
 * pickup have no actor yet and are counted separately.
 */
import * as React from "react";
import { ShieldAlert, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { EBadge, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import type { LaundryTeamMetrics } from "@/lib/laundry/team-metrics";

type Period = "7d" | "30d" | "90d";
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

function pctTone(value: number | null): "success" | "warning" | "danger" | "neutral" {
  if (value == null) return "neutral";
  if (value >= 90) return "success";
  if (value >= 70) return "warning";
  return "danger";
}

const fmtPct = (value: number | null) => (value == null ? "–" : `${value}%`);

function isMetrics(body: unknown): body is LaundryTeamMetrics {
  return Boolean(body) && typeof body === "object" && Array.isArray((body as LaundryTeamMetrics).team) && Array.isArray((body as LaundryTeamMetrics).suppliers);
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">{label}</p>
      {children}
    </div>
  );
}

export function LaundryTeamMetricsPanel() {
  const [period, setPeriod] = React.useState<Period>("30d");
  const [loaded, setLoaded] = React.useState<{ period: Period; data: LaundryTeamMetrics } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const response = await fetch(`/api/admin/laundry/team-metrics?period=${period}`, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !isMetrics(body)) {
          setError("Laundry team metrics could not be loaded.");
          return;
        }
        setLoaded({ period, data: body });
      } catch {
        if (!controller.signal.aborted) setError("Laundry team metrics could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [period]);

  const data = loaded?.period === period ? loaded.data : null;

  return (
    <section id="team-metrics" aria-labelledby="laundry-team-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="laundry-team-heading" className="e-display-sm">Laundry team and suppliers</h2>
        <div role="group" aria-label="Team metrics period" className="flex flex-wrap gap-1.5">
          {PERIODS.map((option) => (
            <button key={option.key} type="button" aria-pressed={period === option.key} onClick={() => setPeriod(option.key)} className={cn(E_CHIP_CLASS, period === option.key && E_CHIP_ON_CLASS)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {loading && !data ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p> : null}
      {error && !data ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      {data ? (
        <>
          <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Our laundry team</p>
          {data.team.length === 0 ? (
            <EEmptyState eyebrow="No data" title="No laundry team activity" description="No active laundry accounts or activity in this window." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.team.map((member) => (
                <ECard key={member.userId}>
                  <ECardBody className="space-y-3 pt-6">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-[550]">{member.name}</span>
                      {member.stuckCount > 0 ? <EBadge tone="danger" soft><ShieldAlert aria-hidden className="h-3 w-3" /> {member.stuckCount} stuck</EBadge> : null}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.8125rem]">
                      <Stat label="Pickups"><p className="e-tnum font-[550]">{member.pickups}</p></Stat>
                      <Stat label="Drops"><p className="e-tnum font-[550]">{member.drops}</p></Stat>
                      <Stat label="On-time drops"><EBadge tone={pctTone(member.onTimeDropPct)} soft>{fmtPct(member.onTimeDropPct)}</EBadge></Stat>
                      <Stat label="Photo compliance"><EBadge tone={pctTone(member.photoCompliancePct)} soft>{fmtPct(member.photoCompliancePct)}</EBadge></Stat>
                      <div className="col-span-2">
                        <Stat label="Avg pickup → drop"><p className="e-tnum">{member.avgCycleDays == null ? "–" : `${member.avgCycleDays} days`}</p></Stat>
                      </div>
                    </div>
                  </ECardBody>
                </ECard>
              ))}
            </div>
          )}
          {data.teamTotals.stuckUnattributed > 0 ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              {data.teamTotals.stuckUnattributed} stuck task{data.teamTotals.stuckUnattributed === 1 ? "" : "s"} awaiting pickup are not yet attributable to a team member.
            </p>
          ) : null}
          <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-muted-foreground))]">External suppliers</p>
          {data.suppliers.length === 0 ? (
            <EEmptyState eyebrow="No suppliers" title="No external suppliers" description="No active laundry suppliers on file." />
          ) : (
            <ECard>
              <ECardBody className="pt-6">
                <ETableShell
                  headers={[
                    { label: "Supplier" },
                    { label: "Phone" },
                    { label: "Price / kg", align: "right" },
                    { label: "Reliability", align: "right" },
                    { label: "Tasks in period", align: "right" },
                  ]}
                >
                  {data.suppliers.map((supplier) => (
                    <tr key={supplier.id}>
                      <td className="px-4 py-3 font-[550]">{supplier.name}</td>
                      <td className="px-4 py-3 text-[hsl(var(--e-muted-foreground))]">{supplier.phone ?? "–"}</td>
                      <td className="px-4 py-3 text-right e-tnum">{supplier.pricePerKg == null ? "–" : `$${supplier.pricePerKg.toFixed(2)}`}</td>
                      <td className="px-4 py-3 text-right">
                        {supplier.reliabilityScore == null ? (
                          <span className="text-[hsl(var(--e-text-faint))]">–</span>
                        ) : (
                          <EBadge tone={supplier.reliabilityScore >= 4 ? "success" : supplier.reliabilityScore >= 2.5 ? "warning" : "danger"} soft>
                            <Star aria-hidden className="h-2.5 w-2.5" /> {supplier.reliabilityScore.toFixed(1)}/5
                          </EBadge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right e-tnum">{supplier.tasksInPeriod}</td>
                    </tr>
                  ))}
                </ETableShell>
              </ECardBody>
            </ECard>
          )}
          {error ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-warning))]">Showing the last loaded figures. {error}</p> : null}
        </>
      ) : null}
    </section>
  );
}
