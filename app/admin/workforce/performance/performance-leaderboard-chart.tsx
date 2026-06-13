"use client";

import { BarCompare } from "@/components/charts";

/**
 * Per-cleaner quality leaderboard. Data is computed server-side from
 * getPerformanceMetrics (only cleaners with a real quality score are passed).
 */
export function PerformanceLeaderboardChart({
  data,
}: {
  data: Array<{ label: string; score: number }>;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No quality scores recorded in the last 30 days yet.
      </div>
    );
  }
  return (
    <BarCompare
      data={data}
      xKey="label"
      dataKey="score"
      horizontal
      tone="primary"
      highlightIndex={0}
      valueFormatter={(v) => `${Math.round(v)}%`}
      height={Math.max(220, data.length * 38)}
    />
  );
}
