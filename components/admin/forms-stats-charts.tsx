"use client";

import { AreaTrend, BarCompare } from "@/components/charts";

/**
 * Client chart section for the form stats page. The server page parses
 * submission JSON defensively and passes plain arrays down.
 */
export function FormsWeeklyVolume({
  data,
}: {
  data: Array<{ label: string; count: number }>;
}) {
  return (
    <AreaTrend
      data={data}
      xKey="label"
      series={[{ dataKey: "count", label: "Submissions", tone: "primary" }]}
      height={240}
    />
  );
}

export function FormsFieldCompletion({
  data,
}: {
  data: Array<{ label: string; completion: number }>;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No completion data for this template.
      </div>
    );
  }
  return (
    <BarCompare
      data={data}
      xKey="label"
      dataKey="completion"
      horizontal
      tone="info"
      valueFormatter={(v) => `${Math.round(v)}%`}
      height={Math.max(220, data.length * 32)}
    />
  );
}
