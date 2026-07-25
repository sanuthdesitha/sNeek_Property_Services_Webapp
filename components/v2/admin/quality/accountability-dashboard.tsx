"use client";

/**
 * ESTATE accountability overview — per-cleaner quality accountability board with
 * rating/score, streak, issue-category and coaching/bonus indicators, plus a
 * category×cleaner matrix and a weekly score trend. Read model from
 * GET /api/admin/accountability/overview?period=7d|30d|90d. Read-only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, TrendingUp, ShieldAlert, Flame, Award, GraduationCap, Star } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEyebrow, EEmptyState, EStatCard } from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";

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

type LaundryTeamRow = {
  userId: string;
  name: string;
  pickups: number;
  drops: number;
  onTimeDropPct: number | null;
  photoCompliancePct: number | null;
  avgCycleDays: number | null;
  stuckCount: number;
};

type LaundrySupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  pricePerKg: number | null;
  avgTurnaround: number | null;
  reliabilityScore: number | null;
  tasksInPeriod: number;
};

type Overview = {
  period: Period;
  cleaners: CleanerRow[];
  laundry?: {
    team: LaundryTeamRow[];
    teamTotals: Omit<LaundryTeamRow, "userId" | "name"> & { stuckUnattributed: number };
    suppliers: LaundrySupplierRow[];
  };
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

function scoreTone(score: number | null): "success" | "warning" | "danger" | "neutral" {
  if (score == null) return "neutral";
  if (score >= 95) return "success";
  if (score >= 85) return "warning";
  return "danger";
}

function fmtScore(v: number | null) {
  return v == null ? "—" : `${v}%`;
}

function pctTone(v: number | null): "success" | "warning" | "danger" | "neutral" {
  if (v == null) return "neutral";
  if (v >= 90) return "success";
  if (v >= 70) return "warning";
  return "danger";
}

function fmtPct(v: number | null) {
  return v == null ? "—" : `${v}%`;
}

const RATING_META: { key: string; label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }[] = [
  { key: "EXCELLENT", label: "Excellent", tone: "success" },
  { key: "PASS", label: "Pass", tone: "info" },
  { key: "NEEDS_IMPROVEMENT", label: "Needs work", tone: "warning" },
  { key: "FAILED", label: "Failed", tone: "danger" },
  { key: "MANAGEMENT_REVIEW", label: "Mgmt review", tone: "danger" },
];

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
      {/* Period toggle */}
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

      {error ? (
        <EEmptyState eyebrow="Error" title="Could not load overview" description={error} />
      ) : null}

      {/* Company stat row */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard
          label="Cleans reviewed"
          value={String(data?.company.totalCleansReviewed ?? 0)}
          delta="authoritative reviews"
          deltaTone="neutral"
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <EStatCard
          label="Company avg score"
          value={fmtScore(data?.company.avgScore ?? null)}
          delta="across all cleans"
          deltaTone="neutral"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <EStatCard
          label="Mgmt review queue"
          value={String(data?.company.managementReviewQueue ?? 0)}
          delta="flagged reviews"
          deltaTone={(data?.company.managementReviewQueue ?? 0) > 0 ? "danger" : "neutral"}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <EStatCard
          label="Issue categories"
          value={String(data?.company.issuesByCategory.length ?? 0)}
          delta="with activity"
          deltaTone="neutral"
          icon={<ShieldAlert className="h-4 w-4" />}
        />
      </section>

      {/* Per-cleaner table */}
      <div className="space-y-3">
        <EEyebrow>CLEANER ACCOUNTABILITY</EEyebrow>
        <ECard>
          <ECardBody className="pt-6">
            {cleaners.length === 0 && !loading ? (
              <EEmptyState eyebrow="No data" title="No cleaner activity" description="No reviews or issues in this window." />
            ) : (
              <ETableShell
                headers={[
                  { label: "Cleaner" },
                  { label: "Cleans", align: "right" },
                  { label: "Avg score", align: "right" },
                  { label: "Rating mix" },
                  { label: "Streak / last 5", align: "right" },
                  { label: "Issues" },
                  { label: "Top categories" },
                  { label: "Flags" },
                ]}
              >
                {cleaners.map((c) => (
                  <tr key={c.cleanerId} className="align-top">
                    <td className="px-4 py-3">
                      <Link
                        href={`/v2/admin/workforce/performance/${c.cleanerId}`}
                        className="font-[550] text-[hsl(var(--e-foreground))] hover:text-[hsl(var(--e-gold-ink))]"
                      >
                        {c.name}
                      </Link>
                      {c.pendingBonuses.count > 0 ? (
                        <div className="mt-1">
                          <EBadge tone="success" soft>
                            <Award className="h-3 w-3" /> {c.pendingBonuses.count} bonus · ${c.pendingBonuses.amount}
                          </EBadge>
                        </div>
                      ) : null}
                      {c.coaching.COACHING + c.coaching.WARNING + c.coaching.MANAGEMENT_REVIEW > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.coaching.COACHING > 0 ? (
                            <EBadge tone="info" soft><GraduationCap className="h-3 w-3" /> {c.coaching.COACHING} coaching</EBadge>
                          ) : null}
                          {c.coaching.WARNING > 0 ? (
                            <EBadge tone="warning" soft>{c.coaching.WARNING} warning</EBadge>
                          ) : null}
                          {c.coaching.MANAGEMENT_REVIEW > 0 ? (
                            <EBadge tone="danger" soft>{c.coaching.MANAGEMENT_REVIEW} mgmt</EBadge>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right e-tnum">{c.cleansReviewed}</td>
                    <td className="px-4 py-3 text-right">
                      <EBadge tone={scoreTone(c.avgScore)} soft>{fmtScore(c.avgScore)}</EBadge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {RATING_META.filter((r) => (c.ratingCounts[r.key] ?? 0) > 0).map((r) => (
                          <EBadge key={r.key} tone={r.tone} soft>{r.label} {c.ratingCounts[r.key]}</EBadge>
                        ))}
                        {RATING_META.every((r) => (c.ratingCounts[r.key] ?? 0) === 0) ? (
                          <span className="text-[hsl(var(--e-text-faint))]">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <EBadge tone={c.currentStreak >= 5 ? "success" : "neutral"} soft>
                          <Flame className="h-3 w-3" /> {c.currentStreak}
                        </EBadge>
                      </div>
                      <div className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))] e-tnum">
                        L5 {fmtScore(c.last5Avg == null ? null : Math.round(c.last5Avg * 10) / 10)} · L10 {fmtScore(c.last10Avg == null ? null : Math.round(c.last10Avg * 10) / 10)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.issuesBySeverity.CRITICAL > 0 ? <EBadge tone="danger" soft>{c.issuesBySeverity.CRITICAL} crit</EBadge> : null}
                        {c.issuesBySeverity.MAJOR > 0 ? <EBadge tone="warning" soft>{c.issuesBySeverity.MAJOR} maj</EBadge> : null}
                        {c.issuesBySeverity.MINOR > 0 ? <EBadge tone="neutral" soft>{c.issuesBySeverity.MINOR} min</EBadge> : null}
                        {c.issuesBySeverity.CRITICAL + c.issuesBySeverity.MAJOR + c.issuesBySeverity.MINOR === 0 ? (
                          <span className="text-[hsl(var(--e-text-faint))]">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.topCategories.map((t) => (
                          <Link key={t.category} href="/v2/admin/quality/issues">
                            <EBadge tone="neutral" soft>{t.label} {t.count}</EBadge>
                          </Link>
                        ))}
                        {c.topCategories.length === 0 ? <span className="text-[hsl(var(--e-text-faint))]">—</span> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.openRectifications > 0 ? <EBadge tone="warning" soft>{c.openRectifications} open rect.</EBadge> : null}
                        {c.falseConfirmations.confirmed > 0 ? <EBadge tone="danger" soft>{c.falseConfirmations.confirmed} false conf.</EBadge> : null}
                        {c.falseConfirmations.suspected > 0 ? <EBadge tone="warning" soft>{c.falseConfirmations.suspected} susp.</EBadge> : null}
                        {c.openRectifications + c.falseConfirmations.confirmed + c.falseConfirmations.suspected === 0 ? (
                          <span className="text-[hsl(var(--e-text-faint))]">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </ETableShell>
            )}
          </ECardBody>
        </ECard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Category × cleaner matrix */}
        <div className="space-y-3">
          <EEyebrow>ISSUES · CATEGORY × CLEANER</EEyebrow>
          <ECard>
            <ECardBody className="pt-6">
              {(data?.company.categoryMatrix.length ?? 0) === 0 ? (
                <EEmptyState eyebrow="All clear" title="No issues logged" description="No QA issues in this window." />
              ) : (
                <ETableShell
                  headers={[
                    { label: "Category" },
                    ...cleaners.map((c) => ({ label: c.name.split(" ")[0], align: "right" as const })),
                    { label: "Total", align: "right" as const },
                  ]}
                >
                  {data!.company.categoryMatrix.map((m) => (
                    <tr key={m.category}>
                      <td className="px-4 py-2.5 font-[550]">{m.label}</td>
                      {cleaners.map((c) => (
                        <td key={c.cleanerId} className="px-4 py-2.5 text-right e-tnum">
                          {m.counts[c.cleanerId] ? m.counts[c.cleanerId] : <span className="text-[hsl(var(--e-text-faint))]">·</span>}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right e-tnum font-[550]">{m.total}</td>
                    </tr>
                  ))}
                </ETableShell>
              )}
            </ECardBody>
          </ECard>
        </div>

        {/* Weekly score trend */}
        <div className="space-y-3">
          <EEyebrow>WEEKLY SCORE TREND</EEyebrow>
          <ECard>
            <ECardBody className="pt-6">
              {(data?.company.weekly.length ?? 0) === 0 ? (
                <EEmptyState eyebrow="No data" title="No reviews yet" description="No authoritative reviews in this window." />
              ) : (
                <div className="flex items-end gap-2" style={{ height: 160 }}>
                  {data!.company.weekly.map((w) => {
                    const h = w.avgScore == null ? 0 : Math.max(4, Math.round((w.avgScore / weeklyMax) * 140));
                    return (
                      <div key={w.weekStart} className="flex flex-1 flex-col items-center justify-end gap-1">
                        <span className="text-[0.6875rem] e-tnum text-[hsl(var(--e-muted-foreground))]">{fmtScore(w.avgScore)}</span>
                        <div
                          className="w-full rounded-t-[4px] bg-[hsl(var(--e-accent-portal))]"
                          style={{ height: h }}
                          title={`${w.weekStart}: ${fmtScore(w.avgScore)} (${w.count} cleans)`}
                        />
                        <span className="text-[0.625rem] text-[hsl(var(--e-text-faint))]">{w.weekStart.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </ECardBody>
          </ECard>
        </div>
      </div>

      {/* Laundry suppliers — internal team + external vendors */}
      <div className="space-y-3">
        <EEyebrow>LAUNDRY SUPPLIERS</EEyebrow>

        {/* Our laundry team — per-person stat cards */}
        <div className="space-y-3">
          <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Our laundry team</p>
          {(data?.laundry?.team.length ?? 0) === 0 && !loading ? (
            <EEmptyState eyebrow="No data" title="No laundry team activity" description="No active laundry accounts or activity in this window." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(data?.laundry?.team ?? []).map((m) => (
                <ECard key={m.userId}>
                  <ECardBody className="space-y-3 pt-6">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-[550] text-[hsl(var(--e-foreground))]">{m.name}</span>
                      {m.stuckCount > 0 ? (
                        <EBadge tone="danger" soft><ShieldAlert className="h-3 w-3" /> {m.stuckCount} stuck</EBadge>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.8125rem]">
                      <div>
                        <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Pickups</p>
                        <p className="e-tnum font-[550]">{m.pickups}</p>
                      </div>
                      <div>
                        <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Drops</p>
                        <p className="e-tnum font-[550]">{m.drops}</p>
                      </div>
                      <div>
                        <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">On-time drops</p>
                        <EBadge tone={pctTone(m.onTimeDropPct)} soft>{fmtPct(m.onTimeDropPct)}</EBadge>
                      </div>
                      <div>
                        <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Photo compliance</p>
                        <EBadge tone={pctTone(m.photoCompliancePct)} soft>{fmtPct(m.photoCompliancePct)}</EBadge>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Avg pickup → drop</p>
                        <p className="e-tnum">{m.avgCycleDays == null ? "—" : `${m.avgCycleDays} days`}</p>
                      </div>
                    </div>
                  </ECardBody>
                </ECard>
              ))}
            </div>
          )}
          {(data?.laundry?.teamTotals.stuckUnattributed ?? 0) > 0 ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              {data!.laundry!.teamTotals.stuckUnattributed} stuck task
              {data!.laundry!.teamTotals.stuckUnattributed === 1 ? "" : "s"} awaiting pickup are not yet
              attributable to a team member.
            </p>
          ) : null}
        </div>

        {/* External suppliers */}
        <div className="space-y-3">
          <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-muted-foreground))]">External suppliers</p>
          <ECard>
            <ECardBody className="pt-6">
              {(data?.laundry?.suppliers.length ?? 0) === 0 ? (
                <EEmptyState eyebrow="No suppliers" title="No external suppliers" description="No active laundry suppliers on file." />
              ) : (
                <ETableShell
                  headers={[
                    { label: "Supplier" },
                    { label: "Phone" },
                    { label: "Price / kg", align: "right" },
                    { label: "Reliability", align: "right" },
                    { label: "Tasks in period", align: "right" },
                  ]}
                >
                  {(data?.laundry?.suppliers ?? []).map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-3 font-[550]">{s.name}</td>
                      <td className="px-4 py-3 text-[hsl(var(--e-muted-foreground))]">{s.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-right e-tnum">
                        {s.pricePerKg == null ? "—" : `$${s.pricePerKg.toFixed(2)}`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.reliabilityScore == null ? (
                          <span className="text-[hsl(var(--e-text-faint))]">—</span>
                        ) : (
                          <EBadge tone={s.reliabilityScore >= 4 ? "success" : s.reliabilityScore >= 2.5 ? "warning" : "danger"} soft>
                            <Star className="h-2.5 w-2.5" /> {s.reliabilityScore.toFixed(1)}/5
                          </EBadge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right e-tnum">{s.tasksInPeriod}</td>
                    </tr>
                  ))}
                </ETableShell>
              )}
            </ECardBody>
          </ECard>
        </div>
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live accountability data from your workspace.</p>
    </div>
  );
}
