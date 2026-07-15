"use client";

/**
 * v1 accountability overview — functional mirror of the Estate v2 board using
 * classic admin primitives. Reads GET /api/admin/accountability/overview.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Flame, Award } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Period = "7d" | "30d" | "90d";

type CleanerRow = {
  cleanerId: string;
  name: string;
  cleansReviewed: number;
  avgScore: number | null;
  ratingCounts: Record<string, number>;
  issuesBySeverity: { MINOR: number; MAJOR: number; CRITICAL: number };
  topCategories: { category: string; label: string; count: number }[];
  falseConfirmations: { suspected: number; confirmed: number };
  openRectifications: number;
  coaching: { COACHING: number; WARNING: number; MANAGEMENT_REVIEW: number };
  currentStreak: number;
  last5Avg: number | null;
  last10Avg: number | null;
  pendingBonuses: { count: number; amount: number };
};

type Overview = {
  period: Period;
  cleaners: CleanerRow[];
  company: {
    weekly: { weekStart: string; avgScore: number | null; count: number }[];
    issuesByCategory: { category: string; label: string; count: number }[];
    categoryMatrix: { category: string; label: string; counts: Record<string, number>; total: number }[];
    managementReviewQueue: number;
    totalCleansReviewed: number;
    avgScore: number | null;
  };
};

const PERIODS: { key: Period; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

const RATING_META: { key: string; label: string; variant: "success" | "secondary" | "warning" | "destructive" }[] = [
  { key: "EXCELLENT", label: "Excellent", variant: "success" },
  { key: "PASS", label: "Pass", variant: "secondary" },
  { key: "NEEDS_IMPROVEMENT", label: "Needs work", variant: "warning" },
  { key: "FAILED", label: "Failed", variant: "destructive" },
  { key: "MANAGEMENT_REVIEW", label: "Mgmt review", variant: "destructive" },
];

function scoreVariant(score: number | null): "success" | "warning" | "destructive" | "secondary" {
  if (score == null) return "secondary";
  if (score >= 95) return "success";
  if (score >= 85) return "warning";
  return "destructive";
}

function fmtScore(v: number | null) {
  return v == null ? "—" : `${v}%`;
}

export function AccountabilityDashboard() {
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/accountability/overview?period=${p}`, { cache: "no-store" });
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

  const weeklyMax = useMemo(() => {
    const scores = (data?.company.weekly ?? []).map((w) => w.avgScore ?? 0);
    return Math.max(100, ...scores);
  }, [data]);

  const cleaners = data?.cleaners ?? [];

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

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Cleans reviewed", value: String(data?.company.totalCleansReviewed ?? 0) },
          { label: "Company avg score", value: fmtScore(data?.company.avgScore ?? null) },
          { label: "Mgmt review queue", value: String(data?.company.managementReviewQueue ?? 0) },
          { label: "Issue categories", value: String(data?.company.issuesByCategory.length ?? 0) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className="mt-2 text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cleaner accountability</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {cleaners.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">No cleaner activity in this window.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Cleaner</th>
                  <th className="px-3 py-2 text-right">Cleans</th>
                  <th className="px-3 py-2 text-right">Avg</th>
                  <th className="px-3 py-2">Ratings</th>
                  <th className="px-3 py-2 text-right">Streak</th>
                  <th className="px-3 py-2">Issues</th>
                  <th className="px-3 py-2">Top categories</th>
                  <th className="px-3 py-2">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {cleaners.map((c) => (
                  <tr key={c.cleanerId}>
                    <td className="px-3 py-3">
                      <Link href={`/admin/workforce/performance/${c.cleanerId}`} className="font-medium text-primary hover:underline">
                        {c.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.pendingBonuses.count > 0 ? (
                          <Badge variant="success"><Award className="mr-1 h-3 w-3" />{c.pendingBonuses.count} bonus · ${c.pendingBonuses.amount}</Badge>
                        ) : null}
                        {c.coaching.COACHING > 0 ? <Badge variant="secondary">{c.coaching.COACHING} coaching</Badge> : null}
                        {c.coaching.WARNING > 0 ? <Badge variant="warning">{c.coaching.WARNING} warning</Badge> : null}
                        {c.coaching.MANAGEMENT_REVIEW > 0 ? <Badge variant="destructive">{c.coaching.MANAGEMENT_REVIEW} mgmt</Badge> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.cleansReviewed}</td>
                    <td className="px-3 py-3 text-right"><Badge variant={scoreVariant(c.avgScore)}>{fmtScore(c.avgScore)}</Badge></td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {RATING_META.filter((r) => (c.ratingCounts[r.key] ?? 0) > 0).map((r) => (
                          <Badge key={r.key} variant={r.variant}>{r.label} {c.ratingCounts[r.key]}</Badge>
                        ))}
                        {RATING_META.every((r) => (c.ratingCounts[r.key] ?? 0) === 0) ? <span className="text-muted-foreground">—</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Badge variant={c.currentStreak >= 5 ? "success" : "secondary"}><Flame className="mr-1 h-3 w-3" />{c.currentStreak}</Badge>
                      <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                        L5 {fmtScore(c.last5Avg == null ? null : Math.round(c.last5Avg * 10) / 10)} · L10 {fmtScore(c.last10Avg == null ? null : Math.round(c.last10Avg * 10) / 10)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.issuesBySeverity.CRITICAL > 0 ? <Badge variant="destructive">{c.issuesBySeverity.CRITICAL} crit</Badge> : null}
                        {c.issuesBySeverity.MAJOR > 0 ? <Badge variant="warning">{c.issuesBySeverity.MAJOR} maj</Badge> : null}
                        {c.issuesBySeverity.MINOR > 0 ? <Badge variant="secondary">{c.issuesBySeverity.MINOR} min</Badge> : null}
                        {c.issuesBySeverity.CRITICAL + c.issuesBySeverity.MAJOR + c.issuesBySeverity.MINOR === 0 ? <span className="text-muted-foreground">—</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.topCategories.map((t) => (
                          <Link key={t.category} href="/admin/quality/issues"><Badge variant="secondary">{t.label} {t.count}</Badge></Link>
                        ))}
                        {c.topCategories.length === 0 ? <span className="text-muted-foreground">—</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.openRectifications > 0 ? <Badge variant="warning">{c.openRectifications} open rect.</Badge> : null}
                        {c.falseConfirmations.confirmed > 0 ? <Badge variant="destructive">{c.falseConfirmations.confirmed} false conf.</Badge> : null}
                        {c.falseConfirmations.suspected > 0 ? <Badge variant="warning">{c.falseConfirmations.suspected} susp.</Badge> : null}
                        {c.openRectifications + c.falseConfirmations.confirmed + c.falseConfirmations.suspected === 0 ? <span className="text-muted-foreground">—</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Issues · category × cleaner</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {(data?.company.categoryMatrix.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No QA issues in this window.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Category</th>
                    {cleaners.map((c) => <th key={c.cleanerId} className="px-3 py-2 text-right">{c.name.split(" ")[0]}</th>)}
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data!.company.categoryMatrix.map((m) => (
                    <tr key={m.category}>
                      <td className="px-3 py-2 font-medium">{m.label}</td>
                      {cleaners.map((c) => (
                        <td key={c.cleanerId} className="px-3 py-2 text-right tabular-nums">
                          {m.counts[c.cleanerId] ? m.counts[c.cleanerId] : <span className="text-muted-foreground">·</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{m.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Weekly score trend</CardTitle></CardHeader>
          <CardContent>
            {(data?.company.weekly.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No reviews in this window.</p>
            ) : (
              <div className="flex items-end gap-2" style={{ height: 160 }}>
                {data!.company.weekly.map((w) => {
                  const h = w.avgScore == null ? 0 : Math.max(4, Math.round((w.avgScore / weeklyMax) * 140));
                  return (
                    <div key={w.weekStart} className="flex flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[11px] tabular-nums text-muted-foreground">{fmtScore(w.avgScore)}</span>
                      <div className="w-full rounded-t bg-primary" style={{ height: h }} title={`${w.weekStart}: ${fmtScore(w.avgScore)} (${w.count} cleans)`} />
                      <span className="text-[10px] text-muted-foreground">{w.weekStart.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
