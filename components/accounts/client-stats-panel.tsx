import { Card, CardContent } from "@/components/ui/card";
import type { ClientStats } from "@/lib/accounts/client-stats";
import { format } from "date-fns";

function StatCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function money(amount: number) {
  return `$${amount.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ClientStatsPanel({ stats }: { stats: ClientStats }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCell
            label="Total spend"
            value={money(stats.totalSpend)}
            hint={`${stats.invoicesPaid} invoices paid`}
          />
          <StatCell
            label="Outstanding"
            value={money(stats.outstandingAmount)}
            hint={`${stats.invoicesOutstanding} open`}
          />
          <StatCell label="Properties" value={stats.propertiesCount} />
          <StatCell label="Active subs" value={stats.activeSubscriptions} />
          <StatCell
            label="Jobs (30d)"
            value={stats.jobsLast30d}
            hint={`Total ${stats.totalJobs}`}
          />
          <StatCell label="Jobs (90d)" value={stats.jobsLast90d} />
          <StatCell
            label="Rating"
            value={
              stats.averageRating !== null ? `★ ${stats.averageRating.toFixed(1)}` : "—"
            }
            hint={stats.ratingSampleSize > 0 ? `n=${stats.ratingSampleSize}` : undefined}
          />
          <StatCell
            label="Last invoice"
            value={stats.lastInvoiceAt ? format(stats.lastInvoiceAt, "MMM d") : "—"}
          />
        </div>
      </CardContent>
    </Card>
  );
}
