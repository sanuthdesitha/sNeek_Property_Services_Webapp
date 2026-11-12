import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { getClientPortalContext } from "@/lib/client/portal";
import { getClientFinanceOverview } from "@/lib/billing/client-portal-finance";
import { buildClientMoneyRow, summarizeToPay, type ClientMoneyRow, type ClientMoneyToPay } from "@/lib/billing/client-portal-money";
import { formatInTimeZone } from "date-fns-tz";
import { EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";
import { PayInvoiceButton } from "@/components/v2/client/pay-invoice-button";
import { SegmentLinks } from "@/components/v2/client/portal/segment-links";
import { ToPayCard } from "@/components/v2/client/money/to-pay-card";
import { InvoiceList } from "@/components/v2/client/money/invoice-list";
import { UnbilledList, UnbilledSummaryCard, type UnbilledCharge } from "@/components/v2/client/money/unbilled";
import { RatesList, type ClientRate } from "@/components/v2/client/money/rates-list";
import { MONEY_TZ, formatAud } from "@/components/v2/client/money/money-format";
import { Info } from "lucide-react";

export const metadata = { title: "Money · Estate client" };
export const dynamic = "force-dynamic";

type MoneyTab = "invoices" | "unbilled" | "rates";
const TABS: readonly MoneyTab[] = ["invoices", "unbilled", "rates"];

type FinanceOverview = NonNullable<Awaited<ReturnType<typeof getClientFinanceOverview>>>;
type InvoiceFacts = FinanceOverview["invoices"][number];

function Unavailable({ message }: { message: string }) {
  return (
    <div role="alert" className="space-y-3">
      <h1 className="e-display-lg">Money unavailable</h1>
      <p>{message}</p>
      <a href="/v2/client/finance" className="inline-flex min-h-11 items-center underline">Retry</a>
    </div>
  );
}

/** Older overview shapes (and tests) carry no money view: derive one with unknown terms. */
function moneyView(finance: FinanceOverview): { rows: ClientMoneyRow[]; toPay: ClientMoneyToPay } {
  if (finance.money) return { rows: finance.money.rows, toPay: finance.money.toPay };
  const todayKey = formatInTimeZone(new Date(), MONEY_TZ, "yyyy-MM-dd");
  const rows = (finance.invoices ?? []).map((invoice: Partial<InvoiceFacts> & Pick<InvoiceFacts, "id" | "invoiceNumber" | "status" | "createdAt">) =>
    buildClientMoneyRow({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      kind: invoice.kind ?? "INVOICE",
      totalAmount: invoice.totalAmount ?? null,
      paidAmount: invoice.paidAmount ?? null,
      paidDate: invoice.paidDate ?? null,
      paidAt: invoice.paidAt ?? null,
      createdAt: invoice.createdAt,
      periodStart: invoice.periodStart ?? null,
      periodEnd: invoice.periodEnd ?? null,
      paymentTermsDays: invoice.paymentTermsDays ?? null,
    }, null, todayKey));
  return { rows, toPay: summarizeToPay(rows) };
}

export default async function V2ClientFinancePage({ searchParams }: { searchParams?: { tab?: string; paid?: string; payment?: string } }) {
  const portalCtx = await requireClientPortalPage({ module: "finance", permission: "invoicesView" });
  const portal = await getClientPortalContext(portalCtx.userId).catch(() => null);
  if (!portal) return <Unavailable message="Account visibility could not be loaded. Try again to see your financial details." />;

  if (!portal.visibility.showFinanceDetails) {
    return (
      <div className="space-y-6">
        <EPageHeader title="Money" description="Invoices, work not yet invoiced and your rates." />
        <EEmptyState eyebrow="Not available" title="Financial details are hidden" description="Your account manager has not enabled finance visibility for this portal." />
      </div>
    );
  }

  const finance = portal.clientId
    ? await getClientFinanceOverview(portal.clientId, portalCtx.propertyIds).catch(() => null)
    : null;
  if (!finance) return <Unavailable message="Financial records could not be loaded. Balances and invoice history are unavailable." />;

  const tab: MoneyTab = TABS.includes(searchParams?.tab as MoneyTab) ? (searchParams?.tab as MoneyTab) : "invoices";
  const { rows, toPay } = moneyView(finance);
  // A single Pay now, for the first invoice in the "pay first" order that the
  // existing payment route accepts. Only the account holder pays.
  const payTarget = portalCtx.actor === "CLIENT"
    ? [toPay.primary, ...rows].find((row): row is ClientMoneyRow => Boolean(row?.payable)) ?? null
    : null;
  const pendingCount = finance.summary?.pendingChargeCount ?? 0;
  const pendingTotal = finance.summary?.pendingChargeTotal ?? 0;
  const creditsFor = Object.fromEntries((finance.invoices ?? []).map((invoice) => [invoice.id, invoice.creditsInvoice?.invoiceNumber]));

  return (
    <div className="space-y-4">
      <EPageHeader title="Money" description={`Invoices, work not yet invoiced and rates for ${portal.client?.name ?? "your account"}.`} />

      {searchParams?.paid === "1" ? (
        <p role="status" className="rounded-[var(--e-radius)] border-l-4 border-[hsl(var(--e-info))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.8125rem]">
          Your payment was handed to the payment provider. The invoice shows Paid once the provider confirms it.
        </p>
      ) : searchParams?.payment === "cancelled" ? (
        <p role="status" className="rounded-[var(--e-radius)] border-l-4 border-[hsl(var(--e-warning))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.8125rem]">
          You left the payment page before finishing. Nothing was recorded as paid; you can choose Pay now again.
        </p>
      ) : null}

      <ToPayCard toPay={toPay} />

      <SegmentLinks
        label="Money sections"
        activeKey={tab}
        links={[
          { key: "invoices", label: "Invoices", href: "/v2/client/finance" },
          { key: "unbilled", label: "Unbilled", href: "/v2/client/finance?tab=unbilled" },
          { key: "rates", label: "Rates", href: "/v2/client/finance?tab=rates" },
        ]}
      />

      {tab === "invoices" ? (
        <section aria-label="Invoices" className="space-y-3">
          <InvoiceList rows={rows} extras={{ creditsFor }} />
          <UnbilledSummaryCard count={pendingCount} total={pendingTotal} />
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Showing the <span>latest 20 invoices, including paid</span>. Credit notes are listed so you can see what reduced a balance.
          </p>
        </section>
      ) : null}
      {tab === "unbilled" ? (
        <section aria-label="Unbilled work" className="space-y-3">
          <p className="text-[0.8125rem]">
            Estimated total <span className="e-numeral">{formatAud(pendingTotal)}</span> across {pendingCount} clean{pendingCount === 1 ? "" : "s"}.
          </p>
          <UnbilledList charges={(finance.recentCharges ?? []) as UnbilledCharge[]} />
        </section>
      ) : null}
      {tab === "rates" ? (
        <section aria-label="Rates">
          <RatesList rates={(finance.rates ?? []) as unknown as ClientRate[]} />
        </section>
      ) : null}

      <p className="flex gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Pay now opens the secure payment page. The invoice shows Paid only after the payment provider confirms it.</span>
      </p>

      {payTarget ? (
        <div className="sticky bottom-[4.75rem] z-20 -mx-4 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-2.5 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
          <PayInvoiceButton invoiceId={payTarget.id} label={`Pay ${formatAud(payTarget.owing)} now`} wide />
        </div>
      ) : null}
    </div>
  );
}
