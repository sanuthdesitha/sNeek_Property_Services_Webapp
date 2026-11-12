/**
 * Invoices in the desktop dashboard's right column: what is owed with View
 * invoice, Download PDF and the single Pay now; the two previous invoices; work
 * not yet invoiced. Same money view and payable rule as the Money tab.
 */
import Link from "next/link";
import { EBadge, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { PayInvoiceButton } from "@/components/v2/client/pay-invoice-button";
import type { ClientHomeData } from "@/lib/client/home-dashboard";
import { dueLabel, formatAud, linesLabel, moneyBadge, periodLabel, sydneyDay } from "@/components/v2/client/money/money-format";

const LINK = "inline-flex min-h-11 items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem] font-[550] hover:bg-[hsl(var(--e-muted))]";

export function DesktopInvoices({ data }: { data: ClientHomeData }) {
  const money = data.finance?.money ?? null;
  const isClient = data.portal.actor === "CLIENT";
  return (
    <section aria-labelledby="desk-invoices" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="desk-invoices" className="text-[1rem] font-semibold">Invoices</h2>
        <Link href="/v2/client/finance" className="inline-flex min-h-11 items-center text-[0.8125rem] underline">Money</Link>
      </div>
      {!money || !data.finance ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Invoices unavailable.</p> : (
        <>
          {money.toPay.primary ? (
            <ECard className="bg-[hsl(var(--e-surface-raised))] p-3">
              <EEyebrow>To pay</EEyebrow>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="e-numeral text-[1.5rem] leading-none">{formatAud(money.toPay.total)}</span>
                <EBadge tone={money.toPay.primary.state === "OVERDUE" ? "danger" : "warning"} soft>{dueLabel(money.toPay.primary)}</EBadge>
              </div>
              <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {[money.toPay.primary.invoiceNumber, periodLabel(money.toPay.primary), linesLabel(money.toPay.primary)].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Link href={`/v2/client/finance/invoices/${money.toPay.primary.id}`} className={LINK}>View invoice</Link>
                {isClient ? <a href={`/api/client/invoices/${encodeURIComponent(money.toPay.primary.id)}/pdf`} className={LINK}>Download PDF</a> : null}
                {isClient && money.toPay.primary.payable ? <span className="ml-auto"><PayInvoiceButton invoiceId={money.toPay.primary.id} /></span> : null}
              </div>
            </ECard>
          ) : <p className="text-[0.8125rem]">Nothing to pay right now.</p>}
          <ul className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
            {money.rows.filter((row) => row.id !== money.toPay.primary?.id).slice(0, 2).map((row) => {
              const badge = moneyBadge(row);
              return (
                <li key={row.id} className="flex items-center gap-2 py-2">
                  <Link href={`/v2/client/finance/invoices/${row.id}`} className="min-w-0 flex-1 hover:underline">
                    <span className="block font-semibold">{row.invoiceNumber}</span>
                    <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{periodLabel(row) ?? `Issued ${sydneyDay(row.createdAt)}`}</span>
                  </Link>
                  <span className="e-numeral">{formatAud(row.totalAmount)}</span>
                  <EBadge tone={badge.tone} soft>{row.state === "PAID" && row.paidOn ? `Paid ${sydneyDay(row.paidOn)}` : badge.label}</EBadge>
                </li>
              );
            })}
            <li className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Not yet invoiced</span>
                <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{data.finance.summary.pendingChargeCount} cleans, estimate</span>
              </span>
              <span className="e-numeral">{formatAud(data.finance.summary.pendingChargeTotal)}</span>
              <EBadge tone="neutral" soft>Next invoice</EBadge>
            </li>
          </ul>
        </>
      )}
    </section>
  );
}
