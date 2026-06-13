"use client";

import { AreaTrend, BarCompare } from "@/components/charts";

/**
 * Client chart section for the laundry stats page. The server page computes
 * the weekly aggregates and per-property volumes with Prisma and passes plain
 * arrays down.
 */
export function LaundryWeeklyTrend({
  data,
}: {
  data: Array<{ week: string; pickedUp: number; dropped: number; scheduled: number }>;
}) {
  return (
    <AreaTrend
      data={data}
      xKey="week"
      series={[
        { dataKey: "scheduled", label: "Scheduled", tone: "primary" },
        { dataKey: "pickedUp", label: "Picked up", tone: "info" },
        { dataKey: "dropped", label: "Dropped", tone: "success" },
      ]}
      height={280}
    />
  );
}

export function LaundryPropertyLeaderboard({
  data,
}: {
  data: Array<{ label: string; count: number }>;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No laundry tasks in the window.
      </div>
    );
  }
  return (
    <BarCompare
      data={data}
      xKey="label"
      dataKey="count"
      horizontal
      tone="primary"
      highlightIndex={0}
      height={Math.max(220, data.length * 38)}
    />
  );
}
