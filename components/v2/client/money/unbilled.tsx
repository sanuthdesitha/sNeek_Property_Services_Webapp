/**
 * Work not yet invoiced (board 4) and the Unbilled segment. Estimates from the
 * existing finance overview (latest 50 completed cleans); never an invoice or a
 * payment request. A clean with no rate says so instead of showing $0.
 */
import { EBadge, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { formatAud, sydneyDay } from "@/components/v2/client/money/money-format";

export interface UnbilledCharge {
  jobId: string;
  jobNumber: string | null;
  propertyName: string;
  suburb: string | null;
  jobType: string;
  scheduledDate: Date;
  amount: number;
  rateMissing: boolean;
  invoiced: boolean;
}

export const UNBILLED_NOTE =
  "Unbilled services are estimates from the latest 50 completed jobs and are not an invoice or a payment request.";

export function UnbilledSummaryCard({ count, total }: { count: number; total: number }) {
  return (
    <ECard className="p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.875rem] font-semibold">Work not yet invoiced</span>
        <span className="e-numeral text-[0.875rem]">{formatAud(total)}</span>
      </div>
      <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        {count === 0 ? "Nothing waiting for the next invoice." : `${count} clean${count === 1 ? "" : "s"} · goes on the next invoice`}
      </p>
      <p className="mt-1.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">{UNBILLED_NOTE}</p>
    </ECard>
  );
}

function label(value: string) {
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function UnbilledList({ charges }: { charges: readonly UnbilledCharge[] }) {
  if (charges.length === 0) {
    return <EEmptyState eyebrow="Nothing yet" title="No billable services" description="Completed work will appear here as it is recorded." />;
  }
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{UNBILLED_NOTE}</p>
      <ECard className="overflow-hidden">
        <ul className="divide-y divide-[hsl(var(--e-border))]">
          {charges.map((row) => (
            <li key={row.jobId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[0.875rem] font-semibold">{row.propertyName}</span>
                <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {[row.suburb, label(row.jobType), sydneyDay(row.scheduledDate, "d MMM yyyy")].filter(Boolean).join(" · ")}
                  {` · Reference ${row.jobNumber || row.jobId}`}
                </span>
              </span>
              <span className="e-numeral text-[0.875rem]">{row.rateMissing ? "Rate not set" : formatAud(row.amount)}</span>
              <EBadge tone={row.rateMissing ? "neutral" : row.invoiced ? "success" : "warning"} soft>
                {row.rateMissing ? "No rate" : row.invoiced ? "Invoiced" : "Pending invoice"}
              </EBadge>
            </li>
          ))}
        </ul>
      </ECard>
    </div>
  );
}
