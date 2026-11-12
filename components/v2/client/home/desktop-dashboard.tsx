/**
 * Client dashboard at desktop width (board "Client portal desktop"): KPI cards,
 * one table answering "how is each home", the month of cleans and linen, and a
 * right column with the only money action (Pay now), decisions and the latest
 * message. The phone screens side by side; no new data. Server-renderable.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { EBadge, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import type { ClientHomeData } from "@/lib/client/home-dashboard";
import { EstateCalendarGrid, type CalendarGridEvent } from "@/components/v2/client/calendar-grid";
import { PropertiesTable } from "@/components/v2/client/home/properties-table";
import { DesktopDecisions } from "@/components/v2/client/home/desktop-decisions";
import { DesktopInvoices } from "@/components/v2/client/home/desktop-invoices";
import { buildPropertyTable } from "@/components/v2/client/home/property-table-rows";
import { formatAud, dueLabel } from "@/components/v2/client/money/money-format";
import {
  cleanerNames, happeningNow, liveLabel, lowStock, sydneyFormat, sydneyKey,
  type HomeJob, type LaundryRow, type StockRow,
} from "@/components/v2/client/home/home-model";

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ECard className="min-w-0 flex-1 p-4">
      <EEyebrow>{label}</EEyebrow>
      <div className="mt-2">{children}</div>
    </ECard>
  );
}

const UNAVAILABLE = <span className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Unavailable</span>;

function KpiRow({ data, todayKey }: { data: ClientHomeData; todayKey: string }) {
  const live = data.jobs ? happeningNow(data.jobs as HomeJob[], todayKey) : null;
  const stock = data.stocks ? lowStock(data.stocks as StockRow[]) : null;
  const toPay = data.finance?.money?.toPay ?? null;
  const decisionCount = data.decisions && data.quotes ? data.decisions.count + data.quotes.length : null;
  const decisionTotal = data.decisions && data.quotes && data.decisions.totalAud !== null
    ? data.decisions.totalAud + data.quotes.reduce((sum, quote) => sum + quote.totalAmount, 0) : null;
  return (
    <div className="flex items-stretch gap-3">
      <Kpi label="Happening now">
        {data.jobs === null ? UNAVAILABLE : live ? (
          <>
            <div className="flex items-center justify-between gap-2"><Link href={`/v2/client/jobs/${live.id}`} className="truncate font-semibold hover:underline">{live.property.name}</Link><EBadge tone="info" soft>{liveLabel(live.status)}</EBadge></div>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {[data.visibility.showCleanerNames ? cleanerNames(live) : null, live.dueTime ? `finish about ${live.dueTime}` : null].filter(Boolean).join(" · ") || "In progress"}
            </p>
          </>
        ) : <p className="text-[0.875rem]">Nothing in progress</p>}
      </Kpi>
      {data.showDecisions ? (
        <Kpi label="Waiting for you">
          {decisionCount === null ? UNAVAILABLE : (
            <div className="flex items-center justify-between gap-2">
              <span className="e-numeral text-[1.75rem] leading-none">{decisionCount}</span>
              {decisionTotal !== null && decisionCount > 0 ? <EBadge tone="warning" soft>{formatAud(decisionTotal)}</EBadge> : null}
            </div>
          )}
        </Kpi>
      ) : null}
      {data.visibility.showFinanceDetails ? (
        <Kpi label="To pay">
          {!toPay ? UNAVAILABLE : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="e-numeral text-[1.75rem] leading-none">{formatAud(toPay.total)}</span>
              {toPay.primary ? <EBadge tone={toPay.primary.state === "OVERDUE" ? "danger" : "warning"} soft>{dueLabel(toPay.primary)}</EBadge> : <EBadge tone="success" soft>Nothing owing</EBadge>}
            </div>
          )}
        </Kpi>
      ) : null}
      {data.visibility.showInventory ? (
        <Kpi label="Low stock">
          {!stock ? UNAVAILABLE : (
            <div className="flex items-center justify-between gap-2">
              <span className="e-numeral text-[1.75rem] leading-none">{stock.total}</span>
              <EBadge tone="neutral" soft>{stock.total === 0 ? "All topped up" : `${stock.properties} ${stock.properties === 1 ? "property" : "properties"}`}</EBadge>
            </div>
          )}
        </Kpi>
      ) : null}
    </div>
  );
}

function calendarEvents(data: ClientHomeData): CalendarGridEvent[] {
  const cleans = (data.jobs ?? []).map((job) => ({
    id: job.id,
    dayKey: sydneyKey(job.scheduledDate),
    title: `${job.property.name}${job.startTime ? ` ${job.startTime}` : ""}`,
    status: job.status,
    subtitle: null,
    href: `/v2/client/jobs/${job.id}`,
  }));
  const linen = ((data.laundry ?? []) as LaundryRow[]).flatMap((task) => [
    { id: `${task.id}-pickup`, dayKey: sydneyKey(task.pickupDate), title: `${task.property.name} pickup`, status: "LAUNDRY", subtitle: "Laundry", href: "/v2/client/laundry" },
    { id: `${task.id}-back`, dayKey: sydneyKey(task.droppedAt ?? task.dropoffDate), title: `${task.property.name} linen back`, status: "LAUNDRY", subtitle: "Laundry", href: "/v2/client/laundry" },
  ]);
  return [...cleans, ...linen];
}

function LatestMessage({ data }: { data: ClientHomeData }) {
  if (!data.showMessages) return null;
  const result = data.latestMessage;
  return (
    <section aria-labelledby="desk-messages" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="desk-messages" className="text-[1rem] font-semibold">Messages</h2>
        {result?.latest?.unread ? <EBadge tone="danger" soft>New</EBadge> : null}
      </div>
      {result === null || result === undefined ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Messages unavailable.</p> : result.latest ? (
        <ECard className="p-3">
          <p className="text-[0.8125rem] font-semibold">sNeek team · {sydneyFormat(result.latest.createdAt, "d MMM HH:mm")}</p>
          <p className="line-clamp-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{result.latest.body}</p>
          <Link href="/v2/client/messages" className="mt-2 inline-flex min-h-11 items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem] font-[550] hover:bg-[hsl(var(--e-muted))]">Reply</Link>
        </ECard>
      ) : <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No messages from the team yet.</p>}
    </section>
  );
}

export function DesktopDashboard({ data, todayKey }: { data: ClientHomeData; todayKey: string }) {
  const table = buildPropertyTable(data);
  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1 space-y-4">
        <KpiRow data={data} todayKey={todayKey} />
        {data.visibility.showProperties ? (
          <ECard className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-4 py-3">
              <h2 className="text-[1rem] font-semibold">Your properties</h2>
              <Link href="/v2/client/properties" className="inline-flex min-h-11 items-center text-[0.8125rem] underline">All properties</Link>
            </div>
            {data.properties === null ? <p className="p-4 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Properties unavailable.</p>
              : table.rows.length === 0 ? <p className="p-4 text-[0.875rem]">No properties found for this account.</p>
              : <PropertiesTable rows={table.rows} columns={table.columns} />}
          </ECard>
        ) : null}
        {data.visibility.showCalendar && data.jobs !== null ? (
          <section aria-label="Calendar of cleans" className="space-y-2">
            <EstateCalendarGrid events={calendarEvents(data)} />
          </section>
        ) : null}
      </div>
      <aside aria-label="Money and decisions" className="w-[22rem] shrink-0 space-y-5">
        {data.visibility.showFinanceDetails ? <DesktopInvoices data={data} /> : null}
        {data.showDecisions ? (
          <section aria-labelledby="desk-decisions" className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 id="desk-decisions" className="text-[1rem] font-semibold">Waiting for your decision</h2>
              <Link href="/v2/client/approvals" className="inline-flex min-h-11 items-center text-[0.8125rem] underline">Approvals</Link>
            </div>
            <DesktopDecisions quotes={data.quotes} />
          </section>
        ) : null}
        <LatestMessage data={data} />
      </aside>
    </div>
  );
}
