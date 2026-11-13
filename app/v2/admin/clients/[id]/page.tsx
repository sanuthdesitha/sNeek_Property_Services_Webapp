import Link from "next/link";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPill } from "@/components/v2/ui/pill";
import { ClientAutomationRules } from "@/components/v2/admin/clients/client-automation-rules";
import { ClientActions } from "@/components/v2/admin/clients/client-actions";
import { ClientProfit } from "@/components/v2/admin/clients/client-profit";
import { ClientPaymentTerms } from "@/components/v2/admin/clients/client-payment-terms";
import { ClientTimeline } from "@/components/v2/admin/clients/client-timeline";
import ClientCommunications from "@/components/v2/admin/clients/client-communications";
import ClientDocuments from "@/components/v2/admin/clients/client-documents";
import { canEditClientPaymentTerms } from "@/lib/billing/client-payment-terms";
import { paymentTermsDaysFrom } from "@/lib/billing/invoice-due";
import { getAppSettings } from "@/lib/settings";
import { mergeClientPortalVisibility, sanitizeClientVisibilityOverride } from "@/lib/client/portal";
import { loadClientPageData } from "@/lib/people/clients/client-page-data";
import { loadClientSummary } from "@/lib/people/clients/summary";
import type { ClientSummary } from "@/lib/people/clients/summary-types";
import { formatMoney } from "@/components/v2/admin/accounts/hub/account-display";
import { FactStrip } from "@/components/v2/admin/people/fact-strip";
import { termsLabel } from "@/components/v2/admin/people/format";
import { ClientHeaderActions, ClientPhoneActions } from "@/components/v2/admin/people/client-page/client-header-actions";
import { ClientRail, type VisibilityItem } from "@/components/v2/admin/people/client-page/client-rail";
import { Card, CasesLeadsCard, NeedsAttention, OutstandingCard, PropertiesTable, QuotesCard, RecentJobsCard } from "@/components/v2/admin/people/client-page/client-sections";

export const metadata = { title: "Client · Estate admin" };
export const dynamic = "force-dynamic";

const CLIENT_TABS = ["overview", "properties", "jobs", "invoices", "profit", "portal", "messages", "documents", "history"] as const;
type ClientTab = (typeof CLIENT_TABS)[number];
const TAB_LABEL: Record<ClientTab, string> = {
  overview: "Overview", properties: "Properties", jobs: "Jobs", invoices: "Invoices", profit: "Profit and pricing",
  portal: "Portal access", messages: "Messages", documents: "Documents", history: "History",
};

function humanize(key: string): string {
  const words = key.replace(/^show/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The client page as drawn (People board, 2026-11-12): header with the
 * status-dependent primary action and More, key facts, tabs (in `?tab=`, so
 * each is linkable and server-rendered), main cards and the right rail.
 * Composed from the existing components and services; nothing here
 * recomputes money (receivables, due days and margin come from Finance).
 */
export default async function AdminClientDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: { tab?: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [data, settings, canEditTerms, rawSummary] = await Promise.all([
    loadClientPageData(params.id),
    getAppSettings(),
    canEditClientPaymentTerms(session.user),
    loadClientSummary(params.id, { money: true, profit: false }),
  ]);
  if (!data || !rawSummary) notFound();
  const tab: ClientTab = (CLIENT_TABS as readonly string[]).includes(searchParams?.tab ?? "") ? (searchParams?.tab as ClientTab) : "overview";
  const { client, recentJobs, outstanding, quotes, cases, leads, profitRow, activeRateCount, ratedPropertyCount } = data;

  // Margin comes from the finance engine row the page already loads (one read).
  const summary: ClientSummary = rawSummary.money
    ? { ...rawSummary, money: { ...rawSummary.money, revenue12: profitRow?.revenue ?? null, cleanerCost12: profitRow?.cleanerCost ?? null, margin12: profitRow?.grossMargin ?? null, marginPct12: profitRow?.marginPct ?? null } }
    : rawSummary;
  const overrides = sanitizeClientVisibilityOverride(client.portalVisibilityOverrides);
  const merged = mergeClientPortalVisibility(settings.clientPortalVisibility, overrides);
  const visibility: VisibilityItem[] = Object.entries(merged).map(([key, shown]) => ({ key, label: humanize(key), shown: shown === true, overridden: Boolean(overrides && key in overrides) }));
  const firstOverdue = summary.money?.invoices.find((invoice) => invoice.overdue) ?? null;
  const actionsClient = {
    id: client.id, name: client.name, email: client.email, phone: client.phone, address: client.address, suburb: client.suburb,
    state: client.state, postcode: client.postcode, notes: client.notes, isActive: client.isActive, portalVisibilityOverrides: overrides,
    showCleanerLiveLocation: client.showCleanerLiveLocation === true,
  };
  const base = `/v2/admin/clients/${client.id}`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/v2/admin/accounts?tab=clients" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] hover:underline">← People · Clients</Link>
          <h1 className="e-display-md flex flex-wrap items-center gap-2">{client.name} <EPill tone={client.isActive ? "ok" : "neutral"}>{client.isActive ? "Active" : "Inactive"}</EPill></h1>
          <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{[client.phone, client.email, [client.address, client.suburb, client.state, client.postcode].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "No contact details"}</p>
        </div>
        <ClientHeaderActions client={actionsClient} defaultPortalVisibility={settings.clientPortalVisibility} overdueInvoice={firstOverdue ? { id: firstOverdue.id, invoiceNumber: firstOverdue.invoiceNumber } : null} />
      </header>

      <FactStrip
        label="Client facts"
        collapsible={{ storageKey: "client:facts" }}
        facts={[
          { key: "since", label: "Client since", value: format(new Date(client.createdAt), "MMM yyyy") },
          { key: "properties", label: "Properties", value: client.properties.length, extra: <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">active</span> },
          { key: "outstanding", label: "Outstanding", value: summary.money?.owing == null ? null : formatMoney(summary.money.owing), extra: (summary.money?.overdue ?? 0) > 0 ? <EPill tone="bad">{formatMoney(summary.money?.overdue ?? 0)} overdue</EPill> : undefined },
          { key: "revenue", label: "Revenue, 12 mo", value: profitRow ? formatMoney(profitRow.revenue) : null },
          { key: "margin", label: "Gross margin, 12 mo", value: profitRow?.marginPct == null ? null : `${profitRow.marginPct.toFixed(0)}%` },
          { key: "terms", label: "Payment terms", value: `${summary.terms.days} days`, extra: <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{summary.terms.source === "CLIENT" ? "own terms" : "default"}</span> },
        ]}
      />

      {/* Phones (board M-People2): the section tabs stay in reach under the app bar. */}
      <nav aria-label="Client sections" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] max-sm:sticky max-sm:top-16 max-sm:z-20 max-sm:-mx-4 max-sm:bg-[hsl(var(--e-background)/0.95)] max-sm:px-4 max-sm:backdrop-blur">
        <div className="flex min-w-max items-center gap-1 border-b border-[hsl(var(--e-border))]">
          {CLIENT_TABS.map((key) => {
            const count = key === "properties" ? summary.properties.length : key === "invoices" ? summary.money?.invoices.length : undefined;
            return (
              <Link key={key} href={key === "overview" ? base : `${base}?tab=${key}`} aria-current={tab === key ? "page" : undefined} className={`-mb-px inline-flex min-h-[2.5rem] max-sm:min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[0.8125rem] ${tab === key ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]" : "border-transparent text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"}`}>
                {TAB_LABEL[key]}{typeof count === "number" ? <span className="e-tnum">{count}</span> : null}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        <section aria-label={TAB_LABEL[tab]} className="flex min-w-0 flex-1 flex-col gap-4">
          {tab === "overview" ? (
            <>
              <NeedsAttention summary={summary} />
              <PropertiesTable summary={summary} limit={5} />
              <div className="grid gap-4 xl:grid-cols-2"><OutstandingCard summary={summary} approved={outstanding} /><QuotesCard quotes={quotes.slice(0, 4)} /></div>
              <div className="grid gap-4 xl:grid-cols-2"><RecentJobsCard jobs={recentJobs.slice(0, 4)} /><CasesLeadsCard cases={cases.slice(0, 3)} leads={leads.slice(0, 2)} /></div>
              <Card title="Activity" action={<Link className="text-[0.8125rem] underline" href={`${base}?tab=history`}>Full history</Link>}>
                <ClientTimeline clientId={client.id} />
              </Card>
            </>
          ) : null}
          {tab === "properties" ? <PropertiesTable summary={summary} /> : null}
          {tab === "jobs" ? <RecentJobsCard jobs={recentJobs} /> : null}
          {tab === "invoices" ? <><OutstandingCard summary={summary} approved={outstanding} /><QuotesCard quotes={quotes} /></> : null}
          {tab === "profit" ? (
            <>
              <ClientPaymentTerms clientId={client.id} paymentTermsDays={client.paymentTermsDays ?? null} organisationDefaultDays={paymentTermsDaysFrom(settings.invoicing?.defaultPaymentTermsDays)} canEdit={canEditTerms} />
              <ClientProfit row={profitRow} rangeLabel="Trailing 12 months" activeRateCount={activeRateCount} ratedPropertyCount={ratedPropertyCount} />
            </>
          ) : null}
          {tab === "portal" ? (
            <Card title="Portal access" action={<ClientActions client={actionsClient} defaultPortalVisibility={settings.clientPortalVisibility} />}>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Edit changes the contact details and what the client sees; Portal invite sends portal access (it resets the client&apos;s portal password); Delete needs your own PIN. Terms: {termsLabel(summary.terms)}.</p>
              <ul className="grid gap-1 text-[0.8125rem] sm:grid-cols-2">
                {visibility.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-2 border-b border-[hsl(var(--e-border)/0.6)] py-1">
                    <span>{item.label}</span>
                    <span className="flex items-center gap-1">{item.overridden ? <span className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">override</span> : null}<EPill tone={item.shown ? "ok" : "neutral"}>{item.shown ? "Shown" : "Hidden"}</EPill></span>
                  </li>
                ))}
              </ul>
              <Link className="text-[0.8125rem] underline" href="/v2/admin/accounts?tab=assistants">Client assistants</Link>
            </Card>
          ) : null}
          {tab === "messages" ? (
            <>
              <ClientCommunications clientId={client.id} />
              <div id="automation"><ClientAutomationRules clientId={client.id} /></div>
            </>
          ) : null}
          {tab === "documents" ? <ClientDocuments clientId={client.id} /> : null}
          {tab === "history" ? <ClientTimeline clientId={client.id} /> : null}
        </section>
        <ClientRail summary={summary} visibility={visibility} />
      </div>
      <ClientPhoneActions clientId={client.id} overdueInvoice={firstOverdue ? { id: firstOverdue.id, invoiceNumber: firstOverdue.invoiceNumber } : null} />
    </div>
  );
}
