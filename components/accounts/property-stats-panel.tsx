import { Card, CardContent } from "@/components/ui/card";
import type { PropertyStats } from "@/lib/accounts/property-stats";
import { format } from "date-fns";

function StatCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PropertyStatsPanel({ stats }: { stats: PropertyStats }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCell label="Total jobs" value={stats.totalJobs} />
            <StatCell label="Last 30d" value={stats.jobsLast30d} />
            <StatCell label="Last 90d" value={stats.jobsLast90d} />
            <StatCell label="Last 365d" value={stats.jobsLast365d} />
            <StatCell
              label="Lifetime value"
              value={`$${stats.lifetimeValue.toLocaleString("en-AU", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}`}
            />
            <StatCell
              label="Avg rating"
              value={
                stats.averageJobRating !== null
                  ? `★ ${stats.averageJobRating.toFixed(1)}`
                  : "—"
              }
              hint={stats.ratingSampleSize > 0 ? `n=${stats.ratingSampleSize}` : undefined}
            />
            <StatCell
              label="Last clean"
              value={stats.lastJobAt ? format(stats.lastJobAt, "MMM d") : "—"}
            />
            <StatCell label="Cleaners serviced" value={stats.cleanersWhoServiced} />
          </div>
        </CardContent>
      </Card>

      {stats.recentMediaUrls.length > 0 ? (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-sm font-semibold">Recent photos</p>
            <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
              {stats.recentMediaUrls.map((url) => (
                <div
                  key={url}
                  className="aspect-square overflow-hidden rounded border border-border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt="Property"
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
