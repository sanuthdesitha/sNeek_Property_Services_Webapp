"use client";

/**
 * People › Clients side panel as drawn: name, client since, Open full client /
 * Send update / New quote, and four tabs (Summary, Money, Logins, Activity).
 * Reads GET /api/admin/clients/[id]/summary; a late answer for another
 * client is dropped, and the panel resets when the client changes.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ClientTimeline } from "@/components/v2/admin/clients/client-timeline";
import { formatLastSeen, formatMoney, formatMonthYear } from "@/components/v2/admin/accounts/hub/account-display";
import type { ClientSummary } from "@/lib/people/clients/summary-types";
import { formatCalendarDay, formatInstantDay, termsLabel } from "../format";
import { useRead } from "../use-read";

const PANEL_TABS = ["summary", "money", "logins", "activity"] as const;
type PanelTab = (typeof PANEL_TABS)[number];
const PANEL_TAB_LABEL: Record<PanelTab, string> = { summary: "Summary", money: "Money", logins: "Logins", activity: "Activity" };

function isSummary(body: unknown): body is ClientSummary {
  return Boolean(body && typeof body === "object" && "id" in body && "properties" in body);
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-[hsl(var(--e-border))] pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="e-eyebrow">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function SummaryTab({ summary }: { summary: ClientSummary }) {
  const overdue = summary.money?.invoices.filter((invoice) => invoice.overdue) ?? [];
  return (
    <div className="flex flex-col gap-3 text-[0.8125rem]">
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-[hsl(var(--e-muted-foreground))]">Contact</dt>
        <dd>
          {summary.phone ? <a href={`tel:${summary.phone}`} className="underline">{summary.phone}</a> : "No phone"}
          <div className="text-[hsl(var(--e-muted-foreground))]">{summary.email ?? "No email"}</div>
        </dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Terms</dt>
        <dd>{termsLabel(summary.terms)}</dd>
        {summary.money ? (
          <>
            <dt className="text-[hsl(var(--e-muted-foreground))]">Owing</dt>
            <dd className="e-tnum">
              {summary.money.owing === null ? "–" : `${formatMoney(summary.money.owing)} across ${summary.money.invoices.length} invoice${summary.money.invoices.length === 1 ? "" : "s"}`}{" "}
              {overdue[0] ? <EPill tone="bad">{overdue[0].invoiceNumber} overdue {overdue[0].daysOverdue} d</EPill> : null}
            </dd>
            <dt className="text-[hsl(var(--e-muted-foreground))]">Margin, 12 mo</dt>
            <dd className="e-tnum">{summary.money.marginPct12 === null ? "–" : `${summary.money.marginPct12.toFixed(0)}%`}</dd>
          </>
        ) : null}
      </dl>
      <Section title={`Properties ${summary.properties.length}`} action={<Link className="underline" href={`/v2/admin/clients/${summary.id}?tab=properties`}>All</Link>}>
        {summary.properties.length === 0 ? <p className="text-[hsl(var(--e-muted-foreground))]">No active properties.</p> : null}
        {summary.properties.slice(0, 5).map((property) => (
          <div key={property.id} className="flex flex-wrap items-center justify-between gap-2">
            <span><b>{property.name}</b> <span className="text-[hsl(var(--e-muted-foreground))]">{property.suburb}</span></span>
            {property.awaitingReview ? <EPill tone="gold">Awaiting review</EPill> : property.nextCleanUnassigned ? <EPill tone="bad">Next clean unassigned</EPill> : (
              <span className="text-[hsl(var(--e-muted-foreground))]">{property.nextCleanAt ? `Next: ${formatInstantDay(property.nextCleanAt)}` : "Nothing booked"}</span>
            )}
          </div>
        ))}
      </Section>
      <Section title="Needs attention">
        {summary.attention.length === 0 ? <p className="text-[hsl(var(--e-muted-foreground))]">Nothing needs attention.</p> : null}
        {summary.attention.map((item) => (
          <Link key={`${item.kind}:${item.href}`} href={item.href} className="flex items-center gap-2 hover:underline">
            <EPill tone={item.kind === "INVOICE" ? "bad" : item.kind === "CASE" ? "warn" : "info"}>{item.kind === "INVOICE" ? "Invoice" : item.kind === "CASE" ? "Case" : "Quote"}</EPill>
            {item.label}
          </Link>
        ))}
      </Section>
    </div>
  );
}

function MoneyTab({ summary }: { summary: ClientSummary }) {
  if (!summary.money) return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Money figures are not available to you.</p>;
  const money = summary.money;
  return (
    <div className="flex flex-col gap-2 text-[0.8125rem]">
      {money.invoices.length === 0 ? <p className="text-[hsl(var(--e-muted-foreground))]">No outstanding invoices.</p> : null}
      {money.invoices.map((invoice) => (
        <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-2">
          <Link href={`/v2/admin/finance/invoices/${invoice.id}`} className="font-[600] hover:underline">{invoice.invoiceNumber}</Link>
          <span className="flex items-center gap-2 e-tnum">
            <span className="text-[hsl(var(--e-muted-foreground))]">due {formatCalendarDay(invoice.dueDay)}</span>
            {formatMoney(invoice.owing)}
            {invoice.overdue ? <EPill tone="bad">Overdue</EPill> : <EPill tone="neutral">{invoice.status === "PART_PAID" ? "Part paid" : "Sent"}</EPill>}
          </span>
        </div>
      ))}
      <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 e-tnum">
        <dt className="text-[hsl(var(--e-muted-foreground))]">Revenue, 12 mo</dt><dd>{money.revenue12 === null ? "–" : formatMoney(money.revenue12)}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Cleaner cost</dt><dd>{money.cleanerCost12 === null ? "–" : formatMoney(money.cleanerCost12)}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Margin</dt><dd>{money.margin12 === null ? "–" : `${formatMoney(money.margin12)}${money.marginPct12 === null ? "" : ` · ${money.marginPct12.toFixed(0)}%`}`}</dd>
      </dl>
    </div>
  );
}

function LoginsTab({ summary }: { summary: ClientSummary }) {
  return (
    <div className="flex flex-col gap-2 text-[0.8125rem]">
      {summary.logins.length === 0 ? <p className="text-[hsl(var(--e-muted-foreground))]">No portal login yet.</p> : null}
      {summary.logins.map((login) => (
        <Link key={login.id} href={`/v2/admin/accounts/users/${login.id}`} className="hover:underline">
          {login.name ?? login.email} <span className="text-[hsl(var(--e-muted-foreground))]">{login.invited ? "invited, not accepted" : !login.isActive ? "disabled" : `last seen ${formatLastSeen(login.lastSeenAt)}`}</span>
        </Link>
      ))}
      {summary.teams.map((team) => (
        <Link key={team.id} href={`/v2/admin/accounts?tab=assistants&team=${team.id}`} className="hover:underline">
          Assistant team &quot;{team.name}&quot; <span className="text-[hsl(var(--e-muted-foreground))]">{team.members} assistant{team.members === 1 ? "" : "s"} · {team.propertyCount === null ? "all properties" : `${team.propertyCount} properties`}{team.isActive ? "" : " · team off"}</span>
        </Link>
      ))}
    </div>
  );
}

export function ClientPanel({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [tab, setTab] = useState<PanelTab>("summary");
  const read = useRead<ClientSummary>(`/api/admin/clients/${encodeURIComponent(clientId)}/summary`, isSummary, { resetOnChange: true, failure: "Could not load the client." });
  useEffect(() => setTab("summary"), [clientId]);
  const summary = read.data && read.data.id === clientId ? read.data : null;

  return (
    <ESidePanel
      open
      label="Client preview"
      title={summary?.name ?? "Client"}
      subtitle={summary ? `Client since ${formatMonthYear(summary.createdAt)}${summary.suburb ? ` · ${summary.suburb}` : ""}` : read.loading ? "Loading…" : undefined}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <EButton asChild size="sm" variant="primary"><Link href={`/v2/admin/clients/${clientId}`}>Open full client</Link></EButton>
          <EButton asChild size="sm" variant="outline"><Link href={`/v2/admin/clients/${clientId}?tab=messages`}>Send update</Link></EButton>
          <EButton asChild size="sm" variant="outline"><Link href="/v2/admin/quotes/new">New quote</Link></EButton>
        </div>
        <div role="tablist" aria-label="Client preview sections" className="flex gap-1 border-b border-[hsl(var(--e-border))]">
          {PANEL_TABS.map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`-mb-px min-h-9 border-b-2 px-2 text-[0.8125rem] ${tab === key ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]" : "border-transparent text-[hsl(var(--e-muted-foreground))]"}`}>
              {PANEL_TAB_LABEL[key]}
            </button>
          ))}
        </div>
        {read.error && !summary ? (
          <EAlert tone="danger">{read.error} <button type="button" className="underline" onClick={read.reload}>Try again</button></EAlert>
        ) : null}
        {!summary && read.loading ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading client…</p> : null}
        {summary && tab === "summary" ? <SummaryTab summary={summary} /> : null}
        {summary && tab === "money" ? <MoneyTab summary={summary} /> : null}
        {summary && tab === "logins" ? <LoginsTab summary={summary} /> : null}
        {tab === "activity" ? <ClientTimeline clientId={clientId} /> : null}
      </div>
    </ESidePanel>
  );
}
