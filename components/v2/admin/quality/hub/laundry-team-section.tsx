"use client";

/**
 * "Laundry team and suppliers" on the Quality hub (parity audit 2026-11-12).
 *
 * The old Accountability page showed "Our laundry team" to anyone with the
 * quality pack. Those figures moved to Laundry statistics, which needs the
 * laundry pack, so an operations manager with quality but not laundry lost
 * them. This section shows the same figures from the quality-pack read route
 * (/api/admin/quality/laundry-team-metrics, the same service as Laundry
 * statistics). It is a lazy disclosure: nothing is read until it is opened,
 * and closing it keeps the chosen period.
 */
import * as React from "react";
import Link from "next/link";
import { ChevronDown, ShieldAlert, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { EBadge, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import type { LaundryTeamMember, LaundryTeamMetrics, LaundrySupplierRow } from "@/lib/laundry/team-metrics";

export const QUALITY_LAUNDRY_TEAM_API = "/api/admin/quality/laundry-team-metrics";
const LAUNDRY_STATS_HREF = "/v2/admin/laundry/stats#team-metrics";
const LOAD_ERROR = "Laundry team metrics could not be loaded.";

type MetricsPeriod = "7d" | "30d" | "90d";
const PERIODS: Array<{ key: MetricsPeriod; label: string }> = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

type BadgeTone = "success" | "warning" | "danger" | "neutral";

function percentTone(value: number | null): BadgeTone {
  if (value == null) return "neutral";
  if (value >= 90) return "success";
  if (value >= 70) return "warning";
  return "danger";
}

function formatPercent(value: number | null): string {
  return value == null ? "–" : `${value}%`;
}

function isMetrics(body: unknown): body is LaundryTeamMetrics {
  if (!body || typeof body !== "object") return false;
  const candidate = body as Partial<LaundryTeamMetrics>;
  return Array.isArray(candidate.team) && Array.isArray(candidate.suppliers);
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">{label}</p>
      {children}
    </div>
  );
}

function TeamMemberCard({ member }: { member: LaundryTeamMember }) {
  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 break-words font-[550]">{member.name}</span>
          {member.stuckCount > 0 ? (
            <EBadge tone="danger" soft>
              <ShieldAlert aria-hidden className="h-3 w-3" /> {member.stuckCount} stuck
            </EBadge>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.8125rem]">
          <Stat label="Pickups">
            <p className="e-tnum font-[550]">{member.pickups}</p>
          </Stat>
          <Stat label="Drops">
            <p className="e-tnum font-[550]">{member.drops}</p>
          </Stat>
          <Stat label="On-time drops">
            <EBadge tone={percentTone(member.onTimeDropPct)} soft>{formatPercent(member.onTimeDropPct)}</EBadge>
          </Stat>
          <Stat label="Photo compliance">
            <EBadge tone={percentTone(member.photoCompliancePct)} soft>{formatPercent(member.photoCompliancePct)}</EBadge>
          </Stat>
          <div className="col-span-2">
            <Stat label="Avg pickup → drop">
              <p className="e-tnum">{member.avgCycleDays == null ? "–" : `${member.avgCycleDays} days`}</p>
            </Stat>
          </div>
        </div>
      </ECardBody>
    </ECard>
  );
}

function SupplierReliability({ supplier }: { supplier: LaundrySupplierRow }) {
  if (supplier.reliabilityScore == null) return <span className="text-[hsl(var(--e-text-faint))]">–</span>;
  const score = supplier.reliabilityScore;
  const tone: BadgeTone = score >= 4 ? "success" : score >= 2.5 ? "warning" : "danger";
  return (
    <EBadge tone={tone} soft>
      <Star aria-hidden className="h-2.5 w-2.5" /> {score.toFixed(1)}/5
    </EBadge>
  );
}

function MetricsBody({ data }: { data: LaundryTeamMetrics }) {
  return (
    <>
      <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Our laundry team</p>
      {data.team.length === 0 ? (
        <EEmptyState eyebrow="No data" title="No laundry team activity" description="No active laundry accounts or activity in this window." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.team.map((member) => (
            <TeamMemberCard key={member.userId} member={member} />
          ))}
        </div>
      )}
      {data.teamTotals.stuckUnattributed > 0 ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          {data.teamTotals.stuckUnattributed} stuck task{data.teamTotals.stuckUnattributed === 1 ? "" : "s"} awaiting pickup are not
          yet attributable to a team member.
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
                    <SupplierReliability supplier={supplier} />
                  </td>
                  <td className="px-4 py-3 text-right e-tnum">{supplier.tasksInPeriod}</td>
                </tr>
              ))}
            </ETableShell>
          </ECardBody>
        </ECard>
      )}
    </>
  );
}

type LoadedMetrics = { period: MetricsPeriod; data: LaundryTeamMetrics };

/** Reads the metrics for `period` while `enabled`; a late answer for another period is dropped. */
function useLaundryTeamMetrics(period: MetricsPeriod, enabled: boolean) {
  const [loaded, setLoaded] = React.useState<LoadedMetrics | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const response = await fetch(`${QUALITY_LAUNDRY_TEAM_API}?period=${period}`, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !isMetrics(body)) {
          setError(LOAD_ERROR);
          return;
        }
        setLoaded({ period, data: body });
      } catch {
        if (!controller.signal.aborted) setError(LOAD_ERROR);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [period, enabled]);

  return { data: loaded?.period === period ? loaded.data : null, error, loading };
}

export function LaundryTeamSection({ laundryStatsLink }: { laundryStatsLink: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [period, setPeriod] = React.useState<MetricsPeriod>("30d");
  const { data, error, loading } = useLaundryTeamMetrics(period, open);
  const panelId = React.useId();

  return (
    <section aria-labelledby={`${panelId}-heading`} className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3">
      <h2 id={`${panelId}-heading`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-[0.9375rem] font-[600] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] sm:min-h-9"
        >
          Laundry team and suppliers
          <ChevronDown aria-hidden className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </h2>
      {open ? (
        <div id={panelId} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Laundry team period" className="flex flex-wrap gap-1.5">
              {PERIODS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={period === option.key}
                  onClick={() => setPeriod(option.key)}
                  className={cn(E_CHIP_CLASS, period === option.key && E_CHIP_ON_CLASS)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {laundryStatsLink ? (
              <Link href={LAUNDRY_STATS_HREF} className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
                Laundry statistics
              </Link>
            ) : null}
          </div>
          {loading && !data ? (
            <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Loading…
            </p>
          ) : null}
          {error && !data ? (
            <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
              {error}
            </p>
          ) : null}
          {data ? <MetricsBody data={data} /> : null}
        </div>
      ) : null}
    </section>
  );
}
