"use client";

import { BarCompare } from "@/components/charts";
import type { JobsTrendPoint } from "@/lib/accounts/user-summary";

/**
 * Completed-jobs-per-month bar chart for the staff summary page. Client
 * wrapper around the chart kit (Recharts components are client-only).
 */
export function StaffJobsTrend({ data }: { data: JobsTrendPoint[] }) {
  const highlightIndex = data.length - 1;
  return (
    <BarCompare
      data={data}
      xKey="label"
      dataKey="jobs"
      height={220}
      highlightIndex={highlightIndex}
      valueFormatter={(v) => `${v}`}
    />
  );
}
