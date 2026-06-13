"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartColors } from "./use-chart-colors";
import { ChartTooltip } from "./chart-tooltip";

/**
 * Sphere-UI rounded gradient bar chart. Single series with optional
 * per-bar highlight (e.g. today, or the max value).
 */
export function BarCompare({
  data,
  xKey,
  dataKey,
  height = 260,
  horizontal = false,
  valueFormatter,
  highlightIndex,
  tone = "primary",
}: {
  data: Array<Record<string, any>>;
  xKey: string;
  dataKey: string;
  height?: number;
  horizontal?: boolean;
  valueFormatter?: (v: number) => string;
  highlightIndex?: number;
  tone?: "primary" | "accent" | "success" | "warning" | "info";
}) {
  const { colors, ref } = useChartColors();
  const color = colors[tone];

  return (
    <div ref={ref} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 12, bottom: 0, left: horizontal ? 8 : -8 }}
          barCategoryGap={horizontal ? "24%" : "32%"}
        >
          <defs>
            <linearGradient id={`bar-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.95} />
              <stop offset="100%" stopColor={color} stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={colors.border} strokeDasharray="3 3" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fill: colors.mutedForeground, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={valueFormatter} />
              <YAxis type="category" dataKey={xKey} tick={{ fill: colors.mutedForeground, fontSize: 11 }} tickLine={false} axisLine={false} width={110} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={{ fill: colors.mutedForeground, fontSize: 11 }} tickLine={false} axisLine={{ stroke: colors.border }} />
              <YAxis tick={{ fill: colors.mutedForeground, fontSize: 11 }} tickLine={false} axisLine={false} width={44} tickFormatter={valueFormatter} />
            </>
          )}
          <Tooltip cursor={{ fill: colors.muted, opacity: 0.4 }} content={<ChartTooltip valueFormatter={valueFormatter} />} />
          <Bar dataKey={dataKey} fill={`url(#bar-${dataKey})`} radius={horizontal ? [0, 8, 8, 0] : [8, 8, 0, 0]} maxBarSize={48}>
            {data.map((_, i) => (
              <Cell key={i} fill={highlightIndex === i ? colors.accent : `url(#bar-${dataKey})`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
