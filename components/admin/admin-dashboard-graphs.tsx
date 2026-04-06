"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PIE_COLORS = ["#1f7a8c", "#f59e0b", "#ef4444", "#10b981", "#6366f1", "#ec4899"];

type MetricRow = {
  label: string;
  value: number;
};

type DailyRow = {
  date: string;
  label: string;
  jobs: number;
};

export function AdminDashboardGraphs({
  jobsByStatus,
  upcomingSevenDayLoad,
  jobTypeBreakdown,
}: {
  jobsByStatus: MetricRow[];
  upcomingSevenDayLoad: DailyRow[];
  jobTypeBreakdown: MetricRow[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <ChartCard title="Jobs by Status" className="xl:col-span-1">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={jobsByStatus} margin={{ top: 12, right: 12, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" angle={-20} textAnchor="end" interval={0} height={64} tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="value" fill="#1f7a8c" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Next 7 Days Load" className="xl:col-span-1">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={upcomingSevenDayLoad} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="jobs" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Service Mix" className="xl:col-span-1">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={jobTypeBreakdown}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={88}
              innerRadius={42}
              paddingAngle={3}
            >
              {jobTypeBreakdown.map((entry, index) => (
                <Cell key={entry.label} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
