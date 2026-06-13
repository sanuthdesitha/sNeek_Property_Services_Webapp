"use client";

import { DollarSign, TrendingUp, Users, Target, AlertTriangle, Gauge } from "lucide-react";
import {
  ChartCard,
  KpiTile,
  AreaTrend,
  BarCompare,
  DonutStat,
  type DonutSlice,
} from "@/components/charts";

interface FinanceDashboardData {
  metrics: {
    mtdRevenue: number;
    ytdRevenue: number;
    avgJobValue: number;
    activeClients: number;
    churnRiskClients: number;
    leadConversionRate: number;
  };
  revenueByMonth: Array<{ label: string; revenue: number }>;
  revenueByServiceType: Array<{ label: string; revenue: number }>;
  revenueByCleaner: Array<{ label: string; revenue: number }>;
  jobsCompletedPerWeek: Array<{ label: string; jobs: number }>;
  qaTrend: Array<{ label: string; score: number }>;
}

function money(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function moneyAxis(value: number) {
  const v = Number(value ?? 0);
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(v)}`;
}

/** Percentage change between the last two points of a numeric series. */
function pctDelta(values: number[]): number | null {
  if (values.length < 2) return null;
  const prev = values[values.length - 2];
  const curr = values[values.length - 1];
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

export function FinanceDashboardWorkspace({ data }: { data: FinanceDashboardData }) {
  const revenueSeries = data.revenueByMonth.map((m) => ({ ...m }));
  const revenueSpark = revenueSeries.map((m) => ({ value: m.revenue }));
  const revenueDelta = pctDelta(revenueSeries.map((m) => m.revenue));

  const jobsSpark = data.jobsCompletedPerWeek.map((w) => ({ value: w.jobs }));
  const jobsDelta = pctDelta(data.jobsCompletedPerWeek.map((w) => w.jobs));

  const qaSpark = data.qaTrend.map((q) => ({ value: q.score }));

  // Real composition: paid-invoice revenue split by service type (top 8).
  const serviceSlices: DonutSlice[] = data.revenueByServiceType.map((s) => ({
    label: s.label,
    value: s.revenue,
  }));
  const totalServiceRevenue = serviceSlices.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="space-y-6">
      {/* KPI row — real deltas/sparklines derived from the trend arrays. */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label="MTD revenue"
          value={money(data.metrics.mtdRevenue)}
          icon={<DollarSign />}
          tone="success"
          delta={revenueDelta}
          deltaLabel="vs last mo"
          spark={revenueSpark}
        />
        <KpiTile
          label="YTD revenue"
          value={money(data.metrics.ytdRevenue)}
          icon={<TrendingUp />}
          tone="primary"
          spark={revenueSpark}
        />
        <KpiTile
          label="Avg job value"
          value={money(data.metrics.avgJobValue)}
          icon={<Gauge />}
          tone="info"
        />
        <KpiTile
          label="Lead conversion"
          value={`${Number(data.metrics.leadConversionRate ?? 0).toFixed(1)}%`}
          icon={<Target />}
          tone="accent"
        />
        <KpiTile
          label="Active clients"
          value={String(data.metrics.activeClients)}
          icon={<Users />}
          tone="primary"
        />
        <KpiTile
          label="Churn risk"
          value={String(data.metrics.churnRiskClients)}
          icon={<AlertTriangle />}
          tone={data.metrics.churnRiskClients > 0 ? "warning" : "neutral"}
          deltaLabel="no booking 60d+"
        />
        <KpiTile
          label="Jobs / week"
          value={String(data.jobsCompletedPerWeek.at(-1)?.jobs ?? 0)}
          icon={<TrendingUp />}
          tone="success"
          delta={jobsDelta}
          deltaLabel="vs last wk"
          spark={jobsSpark}
        />
        <KpiTile
          label="QA score · latest"
          value={`${Math.round(data.qaTrend.at(-1)?.score ?? 0)}%`}
          icon={<Gauge />}
          tone="info"
          spark={qaSpark}
        />
      </section>

      {/* Revenue trend — full-width gradient area. */}
      <ChartCard
        title="Revenue trend"
        subtitle="Paid invoice revenue by month (rolling 24 months)"
      >
        <AreaTrend
          data={revenueSeries}
          xKey="label"
          series={[{ dataKey: "revenue", label: "Revenue", tone: "primary" }]}
          valueFormatter={moneyAxis}
          height={300}
        />
      </ChartCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="Revenue by service type"
          subtitle="Share of paid revenue · top 8"
        >
          <DonutStat
            slices={serviceSlices}
            centerValue={money(totalServiceRevenue)}
            centerLabel="Total"
            valueFormatter={money}
            height={300}
          />
        </ChartCard>

        <ChartCard
          title="Jobs completed per week"
          subtitle="Completed + invoiced jobs"
        >
          <AreaTrend
            data={data.jobsCompletedPerWeek}
            xKey="label"
            series={[{ dataKey: "jobs", label: "Jobs", tone: "accent" }]}
            height={300}
          />
        </ChartCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="Cleaner contribution"
          subtitle="Revenue attributed by assignment · top 10"
        >
          <BarCompare
            data={data.revenueByCleaner}
            xKey="label"
            dataKey="revenue"
            horizontal
            tone="info"
            valueFormatter={moneyAxis}
            highlightIndex={0}
            height={340}
          />
        </ChartCard>

        <ChartCard
          title="Average QA score trend"
          subtitle="Weekly mean inspection score"
        >
          <AreaTrend
            data={data.qaTrend}
            xKey="label"
            series={[{ dataKey: "score", label: "QA score", tone: "success" }]}
            valueFormatter={(v) => `${Math.round(v)}%`}
            height={340}
          />
        </ChartCard>
      </div>
    </div>
  );
}
