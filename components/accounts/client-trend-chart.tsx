"use client";

import { AreaTrend } from "@/components/charts";
import type { ClientTrendPoint } from "@/lib/accounts/client-stats";

const fmtMoney = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Paid-revenue + completed-jobs trend for a client over the last 6 months.
 * Client wrapper around the chart kit (Recharts is client-only).
 */
export function ClientTrendChart({ data }: { data: ClientTrendPoint[] }) {
  return (
    <AreaTrend
      data={data}
      xKey="label"
      height={240}
      series={[
        { dataKey: "revenue", label: "Revenue", tone: "primary" },
        { dataKey: "jobs", label: "Jobs", tone: "accent" },
      ]}
      valueFormatter={(v) => (v >= 100 ? fmtMoney.format(v) : `${v}`)}
    />
  );
}
