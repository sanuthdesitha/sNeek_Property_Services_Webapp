/**
 * Estate Client-360 "Profit & pricing" card — the money roll-up for a single
 * client, sourced from getFinanceSummary().byClient (no finance math is
 * duplicated here; the page passes the already-computed row in). Revenue,
 * cleaner / laundry / supplies cost, total cost and — visually prominent —
 * gross margin ($ + %).
 *
 * Server-rendered presentational component (no client state). Estate token
 * scope only (--e-*), primitives + lucide. No v1 imports.
 */
import { Coins, Sparkles, Wrench } from "lucide-react";
import {
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EBadge,
} from "@/components/v2/ui/primitives";

export type ClientProfitRow = {
  revenue: number;
  cleanerCost: number;
  laundryCost: number;
  suppliesCost: number;
  totalCost: number;
  grossMargin: number;
  marginPct: number | null;
};

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-AU")}`;
}

function pct(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(1)}%`;
}

export function ClientProfit({
  row,
  rangeLabel,
  activeRateCount = 0,
  ratedPropertyCount = 0,
}: {
  row: ClientProfitRow | null;
  rangeLabel: string;
  activeRateCount?: number;
  ratedPropertyCount?: number;
}) {
  const data: ClientProfitRow =
    row ?? { revenue: 0, cleanerCost: 0, laundryCost: 0, suppliesCost: 0, totalCost: 0, grossMargin: 0, marginPct: null };

  const marginPositive = data.grossMargin >= 0;
  const marginColor = marginPositive ? "hsl(var(--e-success))" : "hsl(var(--e-danger))";

  const costLines: { label: string; value: number; icon: typeof Coins }[] = [
    { label: "Cleaner cost", value: data.cleanerCost, icon: Coins },
    { label: "Laundry", value: data.laundryCost, icon: Sparkles },
    { label: "Supplies", value: data.suppliesCost, icon: Wrench },
  ];

  return (
    <ECard>
      <ECardHeader className="flex-row items-center justify-between pb-2">
        <div>
          <ECardTitle className="text-[0.95rem]">Profit & pricing</ECardTitle>
          <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{rangeLabel}</p>
        </div>
        {activeRateCount > 0 ? (
          <EBadge tone="gold" soft>
            {activeRateCount} rate card{activeRateCount === 1 ? "" : "s"}
            {ratedPropertyCount > 0 ? ` · ${ratedPropertyCount} propert${ratedPropertyCount === 1 ? "y" : "ies"}` : ""}
          </EBadge>
        ) : null}
      </ECardHeader>
      <ECardBody className="pt-0">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Prominent gross margin panel */}
          <div
            className="flex flex-col justify-between rounded-[var(--e-radius-lg)] border p-5"
            style={{
              borderColor: `color-mix(in srgb, ${marginColor} 45%, hsl(var(--e-border)))`,
              backgroundColor: `color-mix(in srgb, ${marginColor} 8%, hsl(var(--e-surface)))`,
            }}
          >
            <div className="flex items-center justify-between">
              <p className="e-eyebrow">Gross margin</p>
              <EBadge tone={marginPositive ? "success" : "danger"} soft>{pct(data.marginPct)}</EBadge>
            </div>
            <p className="e-numeral mt-3 text-[2.25rem] leading-none" style={{ color: marginColor }}>
              {money(data.grossMargin)}
            </p>
            <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Revenue {money(data.revenue)} − cost {money(data.totalCost)}
            </p>
          </div>

          {/* Revenue / cost breakdown */}
          <div className="space-y-1">
            <div className="flex items-center justify-between rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3.5 py-2.5">
              <span className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">Revenue</span>
              <span className="e-numeral text-[1rem] text-[hsl(var(--e-foreground))]">{money(data.revenue)}</span>
            </div>
            {costLines.map((line) => {
              const Icon = line.icon;
              return (
                <div key={line.label} className="flex items-center justify-between px-3.5 py-2">
                  <span className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                    <Icon className="h-3.5 w-3.5 text-[hsl(var(--e-text-faint))]" />
                    {line.label}
                  </span>
                  <span className="tabular-nums text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                    −{money(line.value).replace(/^-/, "")}
                  </span>
                </div>
              );
            })}
            <div className="flex items-center justify-between border-t border-[hsl(var(--e-border))] px-3.5 py-2.5">
              <span className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">Total cost</span>
              <span className="e-numeral text-[1rem] text-[hsl(var(--e-foreground))]">−{money(data.totalCost).replace(/^-/, "")}</span>
            </div>
          </div>
        </div>
      </ECardBody>
    </ECard>
  );
}

export default ClientProfit;
