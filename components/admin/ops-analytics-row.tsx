"use client";

import { ChartCard, AreaTrend, DonutStat, type DonutSlice } from "@/components/charts";

/**
 * Thin client wrapper for the Operations Dashboard analytics row. The server
 * page computes the series with Prisma and passes plain arrays down — no logic
 * lives here, just the Sphere-UI chart rendering.
 */
export function OpsAnalyticsRow({
  sevenDayLoad,
  statusSlices,
  totalUpcoming,
}: {
  sevenDayLoad: Array<{ label: string; jobs: number; unassigned: number }>;
  statusSlices: DonutSlice[];
  totalUpcoming: number;
}) {
  const hasStatus = statusSlices.length > 0 && totalUpcoming > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard
        className="lg:col-span-2"
        title="7-day job load"
        subtitle="Scheduled vs unassigned jobs across the next week"
      >
        <AreaTrend
          data={sevenDayLoad}
          xKey="label"
          series={[
            { dataKey: "jobs", label: "Scheduled", tone: "primary" },
            { dataKey: "unassigned", label: "Unassigned", tone: "warning" },
          ]}
          height={260}
        />
      </ChartCard>

      <ChartCard
        title="Job status mix"
        subtitle="Next 7 days by current status"
      >
        {hasStatus ? (
          <DonutStat
            slices={statusSlices}
            centerValue={totalUpcoming}
            centerLabel="Jobs"
            height={260}
          />
        ) : (
          <div className="flex h-[260px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            No scheduled jobs in the next 7 days.
          </div>
        )}
      </ChartCard>
    </div>
  );
}
