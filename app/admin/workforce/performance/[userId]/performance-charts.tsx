"use client";

import { AreaTrend, BarCompare } from "@/components/charts";

export interface WindowedMetric {
  window: string;
  quality: number | null;
  reliability: number | null;
  attendance: number | null;
  satisfaction: number | null;
  docCompliance: number | null;
  training: number | null;
}

interface Props {
  data: WindowedMetric[];
}

/** Multi-series % trend across the 30/90/365-day windows. */
export function PerformanceTrendChart({ data }: Props) {
  return (
    <AreaTrend
      data={data}
      xKey="window"
      series={[
        { dataKey: "quality", label: "Quality", tone: "primary" },
        { dataKey: "reliability", label: "Reliability", tone: "success" },
        { dataKey: "attendance", label: "Attendance", tone: "warning" },
        { dataKey: "docCompliance", label: "Docs", tone: "info" },
        { dataKey: "training", label: "Training", tone: "destructive" },
      ]}
      valueFormatter={(v) => `${Math.round(v)}%`}
      height={280}
    />
  );
}

/** Customer rating (0–5) across the same windows. */
export function SatisfactionTrendChart({ data }: Props) {
  return (
    <BarCompare
      data={data}
      xKey="window"
      dataKey="satisfaction"
      tone="accent"
      valueFormatter={(v) => `★ ${v.toFixed(1)}`}
      height={220}
    />
  );
}
