"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartColors } from "./use-chart-colors";
import { ChartTooltip } from "./chart-tooltip";

export interface AreaSeries {
  dataKey: string;
  label?: string;
  tone?: "primary" | "accent" | "success" | "warning" | "info" | "destructive";
}

/**
 * Sphere-UI gradient area/line trend. One or more series, soft vertical
 * gradient fills, minimal axes. Brand-matched via useChartColors.
 */
export function AreaTrend({
  data,
  xKey,
  series,
  height = 260,
  valueFormatter,
  curved = true,
}: {
  data: Array<Record<string, any>>;
  xKey: string;
  series: AreaSeries[];
  height?: number;
  valueFormatter?: (v: number) => string;
  curved?: boolean;
}) {
  const { colors, ref } = useChartColors();
  const toneColor = (s: AreaSeries) => colors[s.tone ?? "primary"];

  return (
    <div ref={ref} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <defs>
            {series.map((s) => {
              const c = toneColor(s);
              return (
                <linearGradient key={s.dataKey} id={`area-${s.dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={0.34} />
                  <stop offset="100%" stopColor={c} stopOpacity={0} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid stroke={colors.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fill: colors.mutedForeground, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: colors.border }}
          />
          <YAxis
            tick={{ fill: colors.mutedForeground, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={valueFormatter}
          />
          <Tooltip
            cursor={{ stroke: colors.border }}
            content={<ChartTooltip valueFormatter={valueFormatter} />}
          />
          {series.map((s) => {
            const c = toneColor(s);
            return (
              <Area
                key={s.dataKey}
                type={curved ? "monotone" : "linear"}
                name={s.label ?? s.dataKey}
                dataKey={s.dataKey}
                stroke={c}
                strokeWidth={2.5}
                fill={`url(#area-${s.dataKey})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
