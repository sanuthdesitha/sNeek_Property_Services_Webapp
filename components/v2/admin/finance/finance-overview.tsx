"use client";

/**
 * ESTATE finance overview — v2-native replacement for the v1
 * FinanceDashboardWorkspace. Renders the KPI cards + revenue breakdown lists
 * from getFinanceDashboardData / getFinanceHubSummary (passed in from the
 * server page — no client fetch, no charts). Pure Estate tokens.
 */
import { TrendingUp, Wallet, Users, AlertTriangle } from "lucide-react";
import { EStatCard, ECard, EEyebrow, EThread } from "@/components/v2/ui/primitives";

type Bucket = { label: string; revenue: number };

export type FinanceOverviewData = {
  metrics: {
    mtdRevenue: number;
    ytdRevenue: number;
    avgJobValue: number;
    activeClients: number;
    churnRiskClients: number;
    leadConversionRate: number;
  };
  revenueByServiceType: Bucket[];
  revenueByCleaner: Bucket[];
  revenueByMonth: Bucket[];
};

const money = (n: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(n ?? 0));

const money2 = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n ?? 0));

function BreakdownList({
  eyebrow,
  title,
  rows,
  formatLabel,
}: {
  eyebrow: string;
  title: string;
  rows: Bucket[];
  formatLabel?: (s: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <ECard className="p-5">
      <EEyebrow>{eyebrow}</EEyebrow>
      <h3 className="e-display-sm mt-0.5">{title}</h3>
      <EThread className="my-4" />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          No revenue recorded yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[0.875rem] text-[hsl(var(--e-foreground))]">
                  {formatLabel ? formatLabel(r.label) : r.label}
                </span>
                <span className="e-numeral shrink-0 text-[0.875rem] text-[hsl(var(--e-foreground))]">
                  {money2(r.revenue)}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-surface-sunken))]">
                <div
                  className="h-full rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-gold))]"
                  style={{ width: `${Math.max(4, (r.revenue / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ECard>
  );
}

export function FinanceOverview({ data }: { data: FinanceOverviewData }) {
  const m = data.metrics;
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Revenue MTD" value={money(m.mtdRevenue)} icon={<TrendingUp className="h-4 w-4" />} />
        <EStatCard label="Revenue YTD" value={money(m.ytdRevenue)} icon={<Wallet className="h-4 w-4" />} />
        <EStatCard label="Avg job value" value={money2(m.avgJobValue)} icon={<TrendingUp className="h-4 w-4" />} />
        <EStatCard label="Active clients" value={m.activeClients} icon={<Users className="h-4 w-4" />} />
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard
          label="Churn risk"
          value={m.churnRiskClients}
          icon={<AlertTriangle className="h-4 w-4" />}
          delta={m.churnRiskClients > 0 ? "Clients quiet 60d+" : "None flagged"}
          deltaTone={m.churnRiskClients > 0 ? "danger" : "neutral"}
        />
        <EStatCard
          label="Lead conversion"
          value={`${Math.round(m.leadConversionRate)}%`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownList
          eyebrow="By service"
          title="Revenue by service type"
          rows={data.revenueByServiceType}
          formatLabel={(s) => s.replace(/_/g, " ")}
        />
        <BreakdownList
          eyebrow="By cleaner"
          title="Revenue by cleaner"
          rows={data.revenueByCleaner}
        />
      </div>

      <BreakdownList eyebrow="Trend" title="Revenue by month" rows={data.revenueByMonth} />
    </div>
  );
}
