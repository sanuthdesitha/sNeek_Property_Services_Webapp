"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
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
  const totalUpcomingLoad = upcomingSevenDayLoad.reduce((sum, row) => sum + row.jobs, 0);
  const maxDayLoad = upcomingSevenDayLoad.reduce((max, row) => Math.max(max, row.jobs), 0);
  const totalByStatus = jobsByStatus.reduce((sum, row) => sum + row.value, 0);
  const totalByType = jobTypeBreakdown.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <ChartCard title="Jobs by Status" subtitle={`${totalByStatus} tracked jobs in chart window`} className="xl:col-span-1">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={jobsByStatus} margin={{ top: 6, right: 8, left: -14, bottom: 34 }}>
            <defs>
              <linearGradient id="statusBar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0ea5b7" stopOpacity={0.96} />
                <stop offset="100%" stopColor="#155e75" stopOpacity={0.82} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbe6ec" />
            <XAxis dataKey="label" angle={-20} textAnchor="end" interval={0} height={64} tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" fill="url(#statusBar)" radius={[10, 10, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Next 7 Days Load"
        subtitle={`${totalUpcomingLoad} planned jobs | peak ${maxDayLoad} on one day`}
        className="xl:col-span-1"
      >
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={upcomingSevenDayLoad} margin={{ top: 6, right: 8, left: -14, bottom: 8 }}>
            <defs>
              <linearGradient id="loadArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.42} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#efe4c8" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Area type="monotone" dataKey="jobs" stroke="#f59e0b" strokeWidth={3} fill="url(#loadArea)" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Service Mix" subtitle={`${totalByType} jobs across top service types`} className="xl:col-span-1">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={jobTypeBreakdown}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={92}
              innerRadius={48}
              paddingAngle={3}
            >
              {jobTypeBreakdown.map((entry, index) => (
                <Cell key={entry.label} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`overflow-hidden border-slate-200/80 bg-white/95 shadow-[0_14px_34px_-24px_rgba(15,23,42,0.45)] ${className ?? ""}`}>
      <CardHeader className="border-b border-slate-100/90 bg-gradient-to-r from-slate-50 to-white pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  );
}
