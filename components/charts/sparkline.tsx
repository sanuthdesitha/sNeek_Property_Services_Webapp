"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { useChartColors } from "./use-chart-colors";

/**
 * Tiny inline trend line for KPI tiles. No axes, no tooltip — pure shape.
 */
export function Sparkline({
  data,
  dataKey = "value",
  tone = "primary",
  height = 40,
}: {
  data: Array<Record<string, number>>;
  dataKey?: string;
  tone?: "primary" | "accent" | "success" | "warning" | "info" | "destructive";
  height?: number;
}) {
  const { colors, ref } = useChartColors();
  const color = colors[tone];
  const gid = `spark-${tone}-${dataKey}`;

  return (
    <div ref={ref} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gid})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
