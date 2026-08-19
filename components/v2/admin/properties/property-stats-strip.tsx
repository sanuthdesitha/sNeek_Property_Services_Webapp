"use client";

/**
 * Property performance stats for the v2 property workspace — Estate-native
 * port of v1's PropertyStatsPanel (components/accounts/property-stats-panel.tsx
 * + its loader). Same GET /api/admin/properties/:id/stats endpoint; the
 * PropertyStats shape comes from lib/accounts/property-stats.ts, but dates
 * arrive as ISO strings over JSON so they are re-parsed here.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";

interface PropertyStatsDto {
  totalJobs: number;
  jobsLast30d: number;
  jobsLast90d: number;
  jobsLast365d: number;
  lastJobAt: string | null;
  lifetimeValue: number;
  averageJobRating: number | null;
  ratingSampleSize: number;
  recentMediaUrls: string[];
  cleanersWhoServiced: number;
}

function StatCell({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
        {label}
      </p>
      <p className="e-tnum mt-1 text-[1.25rem] font-[550] leading-none">{value}</p>
      {hint ? <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{hint}</p> : null}
    </div>
  );
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "d MMM");
}

export function PropertyStatsStrip({ propertyId }: { propertyId: string }) {
  const [stats, setStats] = useState<PropertyStatsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/properties/${propertyId}/stats`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? "Failed to load stats");
          setStats(null);
          return;
        }
        setStats(body as PropertyStatsDto);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load stats");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="text-[0.95rem]">Performance</ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-4 pt-0">
        {loading ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading stats…</p>
        ) : error || !stats ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{error ?? "Stats unavailable."}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCell label="Total jobs" value={stats.totalJobs} />
              <StatCell label="Last 30d" value={stats.jobsLast30d} />
              <StatCell label="Last 90d" value={stats.jobsLast90d} />
              <StatCell label="Last 365d" value={stats.jobsLast365d} />
              <StatCell
                label="Lifetime value"
                value={`$${(stats.lifetimeValue ?? 0).toLocaleString("en-AU", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}`}
                hint="Paid invoice lines"
              />
              <StatCell
                label="Avg rating"
                value={stats.averageJobRating !== null ? `★ ${stats.averageJobRating.toFixed(1)}` : "—"}
                hint={stats.ratingSampleSize > 0 ? `n=${stats.ratingSampleSize}` : undefined}
              />
              <StatCell label="Last clean" value={fmtDate(stats.lastJobAt)} />
              <StatCell label="Cleaners serviced" value={stats.cleanersWhoServiced} />
            </div>

            {stats.recentMediaUrls.length > 0 ? (
              <div>
                <p className="mb-2 text-[0.8125rem] font-[550]">Recent photos</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {stats.recentMediaUrls.map((url) => (
                    <div
                      key={url}
                      className="aspect-square overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted))]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="Property" className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </ECardBody>
    </ECard>
  );
}
