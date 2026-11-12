/**
 * Rates segment (board 4): the admin-approved property service rates used to
 * invoice completed work. Read-only.
 */
import { ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { formatAud } from "@/components/v2/client/money/money-format";

export interface ClientRate {
  id: string;
  jobType: string;
  baseCharge: number;
  billingUnit: string;
  defaultDescription: string | null;
  property: { name: string; suburb: string | null };
}

function label(value: string) {
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function RatesList({ rates }: { rates: readonly ClientRate[] }) {
  if (rates.length === 0) {
    return <EEmptyState eyebrow="Nothing yet" title="No property rates" description="Rates for your properties will appear here once set by your account manager." />;
  }
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        The current admin-approved charges used to invoice completed work at each property.
      </p>
      <ECard className="overflow-hidden">
        <ul className="divide-y divide-[hsl(var(--e-border))]">
          {rates.map((rate) => (
            <li key={rate.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[0.875rem] font-semibold">{rate.property.name}</span>
                <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {[rate.property.suburb, label(rate.jobType)].filter(Boolean).join(" · ")}
                </span>
                {rate.defaultDescription ? (
                  <span className="mt-0.5 block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{rate.defaultDescription}</span>
                ) : null}
              </span>
              <span className="text-right">
                <span className="e-numeral block text-[0.875rem]">{formatAud(rate.baseCharge)}</span>
                <span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{label(rate.billingUnit)}</span>
              </span>
            </li>
          ))}
        </ul>
      </ECard>
    </div>
  );
}
