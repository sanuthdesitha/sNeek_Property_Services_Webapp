/**
 * Invoices segment (board 4): number, month and issue/paid day, amount, state.
 * Server-renderable. Each row opens the existing invoice page.
 */
import Link from "next/link";
import { EBadge, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import type { ClientMoneyRow } from "@/lib/billing/client-portal-money";
import { formatAud, moneyBadge, periodLabel, sydneyDay } from "@/components/v2/client/money/money-format";

export interface ClientInvoiceListExtras {
  /** Invoice id → the invoice a credit note reduces. */
  creditsFor: Record<string, string | undefined>;
}

function subline(row: ClientMoneyRow): string {
  const month = periodLabel(row);
  const event = row.state === "PAID"
    ? row.paidOn ? `paid ${sydneyDay(row.paidOn)}` : "paid"
    : `issued ${sydneyDay(row.createdAt) ?? "date unavailable"}`;
  return [month, event].filter(Boolean).join(" · ");
}

export function InvoiceList({ rows, extras }: { rows: readonly ClientMoneyRow[]; extras: ClientInvoiceListExtras }) {
  if (rows.length === 0) {
    return <EEmptyState eyebrow="Nothing yet" title="No invoices issued" description="Invoices for completed work will appear here." />;
  }
  return (
    <ECard className="overflow-hidden">
      <ul className="divide-y divide-[hsl(var(--e-border))]">
        {rows.map((row) => {
          const badge = moneyBadge(row);
          const credits = extras.creditsFor[row.id];
          return (
            <li key={row.id}>
              <Link
                href={`/v2/client/finance/invoices/${row.id}`}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-[hsl(var(--e-muted))] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.875rem] font-semibold">{row.invoiceNumber}</span>
                  <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {row.state === "CREDIT_NOTE" && credits ? `Credit note for ${credits} · ` : ""}
                    {subline(row)}
                  </span>
                </span>
                <span className="e-numeral shrink-0 text-[0.875rem]">{formatAud(row.totalAmount)}</span>
                <EBadge tone={badge.tone} soft>{badge.label}</EBadge>
              </Link>
            </li>
          );
        })}
      </ul>
    </ECard>
  );
}
