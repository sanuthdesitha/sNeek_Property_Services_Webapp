"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const COLORS = ["#0f766e", "#2563eb", "#ea580c", "#7c3aed", "#16a34a", "#dc2626", "#0891b2", "#f59e0b"];

function money(value: number) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function tooltipMoney(value: number | string | readonly (number | string)[] | undefined) {
  const numeric = Number(Array.isArray(value) ? value[0] : value ?? 0);
  return money(numeric);
}

function tooltipPercent(value: number | string | readonly (number | string)[] | undefined) {
  const numeric = Number(Array.isArray(value) ? value[0] : value ?? 0);
  return `${numeric.toFixed(1)}%`;
}

export function FinanceDashboardWorkspace({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="MTD Revenue" value={money(data.metrics.mtdRevenue)} />
        <MetricCard label="YTD Revenue" value={money(data.metrics.ytdRevenue)} />
        <MetricCard label="Avg Job Value" value={money(data.metrics.avgJobValue)} />
        <MetricCard label="Active Clients" value={String(data.metrics.activeClients)} />
        <MetricCard label="Churn Risk" value={String(data.metrics.churnRiskClients)} />
        <MetricCard label="Lead Conversion" value={`${Number(data.metrics.leadConversionRate ?? 0).toFixed(1)}%`} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Revenue by Month">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data.revenueByMonth} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(value) => `$${Math.round(value)}`} />
              <Tooltip formatter={tooltipMoney} />
              <Bar dataKey="revenue" fill="#0f766e" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Revenue by Service Type">
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={data.revenueByServiceType} dataKey="revenue" nameKey="label" outerRadius={110} innerRadius={58} paddingAngle={3}>
                {data.revenueByServiceType.map((entry: any, index: number) => (
                  <Cell key={entry.label} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={tooltipMoney} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Revenue by Cleaner">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={data.revenueByCleaner} layout="vertical" margin={{ top: 12, right: 24, left: 24, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={(value) => `$${Math.round(value)}`} />
              <YAxis type="category" dataKey="label" width={120} />
              <Tooltip formatter={tooltipMoney} />
              <Bar dataKey="revenue" fill="#2563eb" radius={[0, 10, 10, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Jobs Completed per Week">
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={data.jobsCompletedPerWeek} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="jobs" stroke="#ea580c" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Average QA Score Trend">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data.qaTrend} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis domain={[0, 100]} />
            <Tooltip formatter={tooltipPercent} />
            <Line type="monotone" dataKey="score" stroke="#16a34a" strokeWidth={3} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
