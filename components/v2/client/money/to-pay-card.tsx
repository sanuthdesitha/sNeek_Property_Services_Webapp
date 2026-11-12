/**
 * "To pay" (board 4, top card): what is still owed across issued invoices and
 * the invoice to pay first. Server-renderable.
 */
import Link from "next/link";
import { EBadge, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import type { ClientMoneyToPay } from "@/lib/billing/client-portal-money";
import { dueLabel, formatAud, linesLabel, moneyBadge, periodLabel } from "@/components/v2/client/money/money-format";

export function ToPayCard({ toPay }: { toPay: ClientMoneyToPay }) {
  const primary = toPay.primary;
  if (!primary) {
    return (
      <ECard className="p-4">
        <EEyebrow>To pay</EEyebrow>
        <p className="mt-1.5 text-[0.9375rem] font-[550]">Nothing to pay right now</p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No issued invoice has an amount owing.</p>
      </ECard>
    );
  }
  const badge = moneyBadge(primary);
  const detail = [primary.invoiceNumber, periodLabel(primary), linesLabel(primary)].filter(Boolean).join(" · ");
  return (
    <ECard className="p-4">
      <EEyebrow>To pay</EEyebrow>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="e-numeral text-[1.875rem] leading-none">{formatAud(toPay.total)}</span>
        <EBadge tone={badge.tone === "danger" ? "danger" : "warning"} soft>{dueLabel(primary)}</EBadge>
      </div>
      <p className="mt-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <Link href={`/v2/client/finance/invoices/${primary.id}`} className="underline-offset-2 hover:underline">{detail}</Link>
        {toPay.outstandingCount > 1 ? ` · ${toPay.outstandingCount} invoices owing` : ""}
      </p>
    </ECard>
  );
}
