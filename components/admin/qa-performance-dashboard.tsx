"use client";

/**
 * v1 QA-performance board — functional mirror of the Estate v2 board using
 * classic admin primitives. Reads GET /api/admin/accountability/qa-performance.
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

function cautionVariant(rate: number | null): "success" | "warning" | "destructive" | "secondary" {
  if (rate == null) return "secondary";
  if (rate >= 15) return "destructive";
  if (rate > 0) return "warning";
  return "success";
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
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
        <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
                (period === p.key ? "bg-primary/12 text-primary" : "text-muted-foreground hover:text-foreground")
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => load(period)} disabled={loading}>
          <RefreshCw className={"mr-2 h-4 w-4 " + (loading ? "animate-spin" : "")} /> Refresh
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        {data?.note ?? "Issue quantity alone is not rewarded — balance found vs fix quality vs misses."}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {inspectors.length === 0 && !loading && !error ? (
        <p className="text-sm text-muted-foreground">No inspector activity in this window.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {inspectors.map((i) => (
            <Card key={i.inspectorId}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">{i.name}</CardTitle>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{titleCase(i.role)}</p>
                </div>
                <Badge variant={cautionVariant(i.caution.complaintRate)}>
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {i.caution.complaintRate == null ? "no passes" : `${i.caution.complaintRate}% complaints`}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric label="Inspections" value={i.inspectionsCompleted} sub="completed" />
                  <Metric label="Avg on-site" value={i.avgOnSiteMinutes == null ? "—" : `${i.avgOnSiteMinutes}m`} sub="per visit" />
                  <Metric label="Issues found" value={i.issuesFound.total} sub={`${i.issuesFound.CRITICAL}C · ${i.issuesFound.MAJOR}M · ${i.issuesFound.MINOR}m`} />
                  <Metric label="Fixed by QA" value={i.issuesFixedByQA} sub="self-rectified" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{i.rectificationMinutes}m rectified</Badge>
                  <Badge variant="secondary">${i.rectificationCost} rect. cost</Badge>
                  {i.falseConfirmationsRaised > 0 ? <Badge variant="warning">{i.falseConfirmationsRaised} false-conf flags</Badge> : null}
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Caution · misses on QA-passed jobs</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {i.caution.complaints} of {i.caution.passedJobs} passed cleans drew low client feedback
                    {i.caution.complaintRate != null ? ` (${i.caution.complaintRate}%).` : "."}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
