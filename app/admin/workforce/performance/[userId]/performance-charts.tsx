"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
} from "recharts";

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

export function PerformanceTrendChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="window"
          tick={{ fontSize: 12 }}
          stroke="hsl(var(--muted-foreground))"
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 12 }}
          stroke="hsl(var(--muted-foreground))"
          label={{
            value: "%",
            angle: -90,
            position: "insideLeft",
            style: { fill: "hsl(var(--muted-foreground))", fontSize: 12 },
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="quality"
          name="Quality"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="reliability"
          name="Reliability"
          stroke="hsl(var(--success))"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="attendance"
          name="Attendance"
          stroke="hsl(var(--warning))"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="docCompliance"
          name="Docs"
          stroke="hsl(var(--info))"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="training"
          name="Training"
          stroke="hsl(var(--destructive))"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SatisfactionTrendChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="window"
          tick={{ fontSize: 12 }}
          stroke="hsl(var(--muted-foreground))"
        />
        <YAxis
          domain={[0, 5]}
          tick={{ fontSize: 12 }}
          stroke="hsl(var(--muted-foreground))"
          label={{
            value: "★",
            angle: -90,
            position: "insideLeft",
            style: { fill: "hsl(var(--muted-foreground))", fontSize: 12 },
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
            fontSize: 12,
          }}
        />
        <Bar
          dataKey="satisfaction"
          name="Customer rating"
          fill="hsl(var(--primary))"
          radius={[6, 6, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
