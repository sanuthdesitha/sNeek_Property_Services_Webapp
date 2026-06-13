"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useChartColors } from "./use-chart-colors";
import { ChartTooltip } from "./chart-tooltip";

export interface DonutSlice {
  label: string;
  value: number;
  /** Optional explicit tone; otherwise the series palette is used in order. */
  tone?: "primary" | "accent" | "success" | "warning" | "info" | "destructive";
}

/**
 * Sphere-UI donut with a center label. Great for status/composition breakdowns.
 */
export function DonutStat({
  slices,
  height = 240,
  centerValue,
  centerLabel,
  valueFormatter,
}: {
  slices: DonutSlice[];
  height?: number;
  centerValue?: React.ReactNode;
  centerLabel?: React.ReactNode;
  valueFormatter?: (v: number) => string;
}) {
  const { colors, ref } = useChartColors();
  const colorFor = (s: DonutSlice, i: number) => (s.tone ? colors[s.tone] : colors.series[i % colors.series.length]);
  const data = slices.map((s) => ({ name: s.label, value: s.value }));

  return (
    <div ref={ref} style={{ height }} className="relative w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <defs>
            {slices.map((s, i) => {
              const c = colorFor(s, i);
              return (
                <linearGradient key={i} id={`donut-${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={1} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.6} />
                </linearGradient>
              );
            })}
          </defs>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
          >
            {slices.map((_, i) => (
              <Cell key={i} fill={`url(#donut-${i})`} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
        </PieChart>
      </ResponsiveContainer>
      {(centerValue != null || centerLabel != null) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue != null ? (
            <span className="text-2xl font-bold tabular-nums text-foreground">{centerValue}</span>
          ) : null}
          {centerLabel != null ? (
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{centerLabel}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
