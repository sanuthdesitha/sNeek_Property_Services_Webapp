"use client";

/**
 * ESTATE QA-performance board — per-inspector cards showing inspections, on-site
 * time, issues found/fixed, rectification totals, false-conf flags and the
 * CAUTION metric (complaint rate on QA-passed jobs). Read model from
 * GET /api/admin/accountability/qa-performance?period=7d|30d|90d. Read-only.
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ClipboardCheck, Clock3, Wrench, AlertTriangle } from "lucide-react";
import { EAlert, EBadge, EButton, ECard, ECardBody, EEyebrow, EEmptyState } from "@/components/v2/ui/primitives";

type Period = "7d" | "30d" | "90d";

type Inspector = {
  inspectorId: string;
  name: string;
  role: string;
  inspectionsCompleted: number;
  avgOnSiteMinutes: number | null;
  issuesFound: { MINOR: number; MAJOR: number; CRITICAL: number; total: number };
  issuesFixedByQA: number;
  rectificationMinutes: number;
  rectificationCost: number;
  falseConfirmationsRaised: number;
  caution: { passedJobs: number; complaints: number; complaintRate: number | null };
};

type QaPerf = { period: Period; note: string; inspectors: Inspector[] };

const PERIODS: { key: Period; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

function titleCase(v: string) {
  return v.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function cautionTone(rate: number | null): "success" | "warning" | "danger" | "neutral" {
  if (rate == null) return "neutral";
  if (rate >= 15) return "danger";
  if (rate > 0) return "warning";
  return "success";
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
      <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">{label}</p>
      <p className="e-numeral mt-1 text-[1.25rem] leading-none">{value}</p>
      {sub ? <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">{sub}</p> : null}
    </div>
  );
}

export function QaPerformanceDashboard() {
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<QaPerf | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/accountability/qa-performance?period=${p}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed to load.");
      setData(await res.json());
    } catch (e: any) {
      setError(e?.message ?? "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  const inspectors = data?.inspectors ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={
                "rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors " +
                (period === p.key
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <EButton variant="outline" size="sm" onClick={() => load(period)} disabled={loading}>
          <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} /> Refresh
        </EButton>
      </div>

      <EAlert tone="info" title="How QA performance is read">
        {data?.note ?? "Issue quantity alone is not rewarded — balance found vs fix quality vs misses."}
      </EAlert>

      {error ? <EEmptyState eyebrow="Error" title="Could not load QA performance" description={error} /> : null}

      {inspectors.length === 0 && !loading && !error ? (
        <EEmptyState eyebrow="No data" title="No inspector activity" description="No inspections or issues in this window." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {inspectors.map((i) => (
            <ECard key={i.inspectorId}>
              <ECardBody className="space-y-4 pt-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[1.0625rem] font-[550]">{i.name}</p>
                    <EEyebrow>{titleCase(i.role)}</EEyebrow>
                  </div>
                  <EBadge tone={cautionTone(i.caution.complaintRate)} soft>
                    <AlertTriangle className="h-3 w-3" />
                    {i.caution.complaintRate == null ? "no passes" : `${i.caution.complaintRate}% complaints`}
                  </EBadge>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric label="Inspections" value={i.inspectionsCompleted} sub={<><ClipboardCheck className="mr-1 inline h-3 w-3" />completed</>} />
                  <Metric label="Avg on-site" value={i.avgOnSiteMinutes == null ? "—" : `${i.avgOnSiteMinutes}m`} sub={<><Clock3 className="mr-1 inline h-3 w-3" />per visit</>} />
                  <Metric label="Issues found" value={i.issuesFound.total} sub={`${i.issuesFound.CRITICAL}C · ${i.issuesFound.MAJOR}M · ${i.issuesFound.MINOR}m`} />
                  <Metric label="Fixed by QA" value={i.issuesFixedByQA} sub={<><Wrench className="mr-1 inline h-3 w-3" />self-rectified</>} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <EBadge tone="neutral" soft>{i.rectificationMinutes}m rectified</EBadge>
                  <EBadge tone="neutral" soft>${i.rectificationCost} rect. cost</EBadge>
                  {i.falseConfirmationsRaised > 0 ? (
                    <EBadge tone="warning" soft>{i.falseConfirmationsRaised} false-conf flags</EBadge>
                  ) : null}
                </div>

                <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                  <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">
                    Caution · misses on QA-passed jobs
                  </p>
                  <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                    {i.caution.complaints} of {i.caution.passedJobs} passed cleans drew low client feedback
                    {i.caution.complaintRate != null ? ` (${i.caution.complaintRate}%).` : "."}
                  </p>
                </div>
              </ECardBody>
            </ECard>
          ))}
        </div>
      )}

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live QA performance data from your workspace.</p>
    </div>
  );
}
