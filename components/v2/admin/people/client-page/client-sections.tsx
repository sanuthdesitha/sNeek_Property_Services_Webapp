/**
 * Client page main cards as drawn: Needs attention, Properties (next clean,
 * last clean, turnover rate, calendar), Outstanding invoices, Quotes, Recent
 * jobs, Cases and leads. Server-renderable (no hooks); data from
 * loadClientPageData and loadClientSummary.
 */
import Link from "next/link";
import { format } from "date-fns";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { formatMoney } from "@/components/v2/admin/accounts/hub/account-display";
import type { ClientPageData } from "@/lib/people/clients/client-page-data";
import type { ClientSummary } from "@/lib/people/clients/summary-types";
import { formatCalendarDay, formatInstant, formatInstantDay } from "../format";
import { AttachClientDisclosure } from "@/components/v2/admin/properties/attach-client-form";
import { caseStateTone, formatEstimate, jobStatusTone, leadStatusTone, quoteStatusTone, titleCase } from "./tones";

export function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`flex min-w-0 flex-col gap-2 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[0.9375rem] font-[600]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const muted = "text-[hsl(var(--e-muted-foreground))]";

export function NeedsAttention({ summary }: { summary: ClientSummary }) {
  if (summary.attention.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3 text-[0.8125rem]">
      <b>Needs attention:</b>
      {summary.attention.map((item, index) => (
        <span key={`${item.kind}:${item.href}`} className="inline-flex items-center gap-1.5">
          {index > 0 ? <span className={muted}>·</span> : null}
          <EPill tone={item.kind === "INVOICE" ? "bad" : item.kind === "CASE" ? "warn" : "info"}>{item.kind === "INVOICE" ? "Invoice" : item.kind === "CASE" ? "Case" : "Quote"}</EPill>
          <Link href={item.href} className="hover:underline">{item.label}</Link>
        </span>
      ))}
    </div>
  );
}

const CALENDAR_LABEL = { SYNCED: "Synced", FAILED: "Sync failed", NOT_CONNECTED: "Not connected", DISABLED: "Switched off" } as const;

export function PropertiesTable({ summary, limit }: { summary: ClientSummary; limit?: number }) {
  // One-off sites (made by New job for work outside the managed portfolio) are
  // listed in their own group, as the Properties list keeps them apart too.
  const managed = summary.properties.filter((property) => !property.oneOff);
  const oneOff = summary.properties.filter((property) => property.oneOff);
  const rows = limit ? managed.slice(0, limit) : managed;
  return (
    <>
      <Card
        title="Properties"
        action={
          <div className="flex items-center gap-2">
            <EButton asChild size="sm" variant="outline"><Link href={`/v2/admin/properties/new?clientId=${encodeURIComponent(summary.id)}`}>Add property</Link></EButton>
            {limit ? <Link className="text-[0.8125rem] underline" href={`/v2/admin/clients/${summary.id}?tab=properties`}>All {managed.length}</Link> : null}
          </div>
        }
      >
        {limit && oneOff.length > 0 ? (
          <p className={`text-[0.8125rem] ${muted}`}>
            {oneOff.length} one-off site{oneOff.length === 1 ? "" : "s"}{summary.oneOffCatchAll ? " waiting for a client" : ""}:{" "}
            <Link className="underline" href={`/v2/admin/clients/${summary.id}?tab=properties`}>see Properties</Link>
          </p>
        ) : null}
        {rows.length === 0 ? <p className={`text-[0.8125rem] ${muted}`}>{oneOff.length > 0 ? (limit ? "No managed properties." : "No managed properties. One-off sites are listed below.") : "No active properties."}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[0.8125rem]">
              <thead><tr className={`text-left text-[0.75rem] ${muted}`}><th className="py-1.5 pr-3">Property</th><th className="py-1.5 pr-3">Next clean</th><th className="py-1.5 pr-3">Last clean</th><th className="py-1.5 pr-3 text-right">Turnover rate</th><th className="py-1.5">Calendar</th></tr></thead>
              <tbody>
                {rows.map((property) => (
                  <tr key={property.id} className="border-t border-[hsl(var(--e-border)/0.7)]">
                    <td className="py-2 pr-3"><Link href={`/v2/admin/properties/${property.id}`} className="font-[600] hover:underline">{property.name}</Link> <span className={muted}>{property.suburb}</span></td>
                    <td className="py-2 pr-3">{property.nextCleanAt ? formatInstant(property.nextCleanAt) : <span className={muted}>Nothing booked</span>} {property.nextCleanUnassigned ? <EPill tone="bad">Unassigned</EPill> : null}</td>
                    <td className="py-2 pr-3">{property.lastCleanAt ? formatInstantDay(property.lastCleanAt) : <span className={muted}>Not recorded</span>} {property.awaitingReview ? <EPill tone="gold">Awaiting review</EPill> : null}</td>
                    <td className="py-2 pr-3 text-right e-tnum">{property.turnoverRate === null ? <EPill tone="warn">No rate</EPill> : formatMoney(property.turnoverRate)}</td>
                    <td className="py-2"><EPill tone={property.calendar === "SYNCED" ? "ok" : property.calendar === "FAILED" ? "warn" : "neutral"}>{CALENDAR_LABEL[property.calendar]}{property.calendarFailedSince ? ` since ${formatInstantDay(property.calendarFailedSince)}` : ""}</EPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {oneOff.length > 0 && !limit ? <OneOffSitesCard summary={summary} sites={oneOff} /> : null}
    </>
  );
}

/**
 * One-off sites: each with its jobs and the last and next job. Under the
 * catch-all "Unassigned / One-off Jobs" client each site offers "Attach to
 * client", the only way its jobs reach a real client's history and invoices.
 */
function OneOffSitesCard({ summary, sites }: { summary: ClientSummary; sites: ClientSummary["properties"] }) {
  return (
    <Card title="One-off sites">
      <p className={`text-[0.8125rem] ${muted}`}>
        {summary.oneOffCatchAll
          ? "Sites of one-off jobs made without a client. They cannot be invoiced to anyone until each is attached to its client."
          : "Sites made by New job for one-off work. They are kept out of the managed portfolio; their jobs are billed to this client like any other."}
      </p>
      <ul className="divide-y divide-[hsl(var(--e-border)/0.7)] text-[0.8125rem]">
        {sites.map((site) => (
          <li key={site.id} className="space-y-2 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <Link href={`/v2/admin/properties/${site.id}`} className="font-[600] hover:underline">{site.name}</Link> <span className={muted}>{site.suburb}</span>{" "}
                <EPill tone="neutral">One-off</EPill>
              </span>
              <span className={`e-tnum ${muted}`}>
                {site.jobCount} job{site.jobCount === 1 ? "" : "s"}
                {site.lastCleanAt ? ` · last ${formatInstantDay(site.lastCleanAt)}` : ""}
                {site.nextCleanAt ? ` · next ${formatInstantDay(site.nextCleanAt)}` : ""}
                {" · "}
                <Link className="underline" href={`/v2/admin/jobs?propertyId=${encodeURIComponent(site.id)}`}>Jobs</Link>
              </span>
            </div>
            {summary.oneOffCatchAll ? (
              <AttachClientDisclosure key={site.id} propertyId={site.id} siteName={site.name} jobCount={site.jobCount} expectedUpdatedAt={site.updatedAt} />
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function OutstandingCard({ summary, approved }: { summary: ClientSummary; approved: ClientPageData["outstanding"] }) {
  const invoices = summary.money?.invoices ?? [];
  const approvedOnly = approved.filter((invoice) => invoice.status === "APPROVED");
  return (
    <Card title="Outstanding invoices" action={<Link className="text-[0.8125rem] underline" href="/v2/admin/finance/invoices">All invoices</Link>}>
      {!summary.money ? <p className={`text-[0.8125rem] ${muted}`}>Not available.</p> : null}
      {summary.money && invoices.length === 0 ? <p className={`text-[0.8125rem] ${muted}`}>No outstanding invoices.</p> : null}
      {invoices.map((invoice) => (
        <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
          <span><Link href={`/v2/admin/finance/invoices/${invoice.id}`} className="font-[600] hover:underline">{invoice.invoiceNumber}</Link> <span className={`e-tnum ${muted}`}>due {formatCalendarDay(invoice.dueDay)}</span></span>
          <span className="flex items-center gap-2 e-tnum">
            {formatMoney(invoice.owing)}
            {invoice.overdue ? <EPill tone="bad">Overdue</EPill> : <EPill tone={invoice.status === "PART_PAID" ? "warn" : "neutral"}>{invoice.status === "PART_PAID" ? "Part paid" : "Sent"}</EPill>}
            <a href={`/api/admin/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer" className="underline">PDF</a>
          </span>
        </div>
      ))}
      {approvedOnly.length > 0 ? (
        <p className={`text-[0.75rem] ${muted}`}>Approved, not sent yet: {approvedOnly.map((invoice) => invoice.invoiceNumber).join(", ")}</p>
      ) : null}
    </Card>
  );
}

export function QuotesCard({ quotes }: { quotes: ClientPageData["quotes"] }) {
  return (
    <Card title="Quotes" action={<Link className="text-[0.8125rem] underline" href="/v2/admin/quotes">All quotes</Link>}>
      {quotes.length === 0 ? <p className={`text-[0.8125rem] ${muted}`}>No quotes for this client yet.</p> : null}
      {quotes.map((quote) => (
        <div key={quote.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
          <span><Link href={`/v2/admin/quotes/${quote.id}`} className="font-[600] hover:underline">{titleCase(quote.serviceType)}</Link> <span className={muted}>{format(new Date(quote.createdAt), "d MMM yy")}{quote.validUntil ? ` · valid until ${format(new Date(quote.validUntil), "d MMM yy")}` : ""}</span></span>
          <span className="flex items-center gap-2 e-tnum">${quote.totalAmount.toFixed(2)} <EBadge tone={quoteStatusTone(quote.status)} soft>{titleCase(quote.status)}</EBadge> <a href={`/api/admin/quotes/${quote.id}/pdf`} target="_blank" rel="noreferrer" className="underline">PDF</a></span>
        </div>
      ))}
    </Card>
  );
}

export function RecentJobsCard({ jobs, clientId }: { jobs: ClientPageData["recentJobs"]; clientId?: string }) {
  // "All jobs" opens the Jobs list filtered to this client (managed and one-off sites alike).
  const allHref = clientId ? `/v2/admin/jobs?clientId=${encodeURIComponent(clientId)}` : "/v2/admin/jobs";
  return (
    <Card title="Recent jobs" action={<Link className="text-[0.8125rem] underline" href={allHref}>All jobs</Link>}>
      {jobs.length === 0 ? <p className={`text-[0.8125rem] ${muted}`}>Nothing scheduled yet.</p> : null}
      {jobs.map((job) => (
        <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
          <span><Link href={`/v2/admin/jobs/${job.id}`} className="font-[600] hover:underline">{job.jobNumber}</Link> {job.property?.name ?? "Property"} · {format(new Date(job.scheduledDate), "d MMM yy")} <span className={muted}>{titleCase(job.jobType)}</span>{job.oneOff ? <> <EPill tone="neutral">One-off</EPill></> : null}</span>
          <EBadge tone={jobStatusTone(job.status)} soft>{titleCase(job.status)}</EBadge>
        </div>
      ))}
    </Card>
  );
}

export function CasesLeadsCard({ cases, leads }: { cases: ClientPageData["cases"]; leads: ClientPageData["leads"] }) {
  return (
    <Card title="Cases and leads" action={<Link className="text-[0.8125rem] underline" href="/v2/admin/cases">All cases</Link>}>
      {cases.length === 0 ? <p className={`text-[0.8125rem] ${muted}`}>No cases linked to this client.</p> : null}
      {cases.map((row) => (
        <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
          <span><Link href={`/v2/admin/cases?caseId=${row.id}`} className="hover:underline">{row.title}</Link> <span className={muted}>· {titleCase(row.caseType)} · {format(new Date(row.createdAt), "d MMM yy")}</span></span>
          <EBadge tone={caseStateTone(row.state)} soft>{titleCase(row.state)}</EBadge>
        </div>
      ))}
      <div className="my-1 h-px bg-[hsl(var(--e-border))]" />
      {leads.length === 0 ? <p className={`text-[0.8125rem] ${muted}`}>No linked leads.</p> : null}
      {leads.map((lead) => (
        <div key={lead.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
          <span>Lead: {titleCase(lead.serviceType)} <span className={muted}>· estimate {formatEstimate(lead.estimateMin, lead.estimateMax)} · {format(new Date(lead.createdAt), "d MMM yy")}</span></span>
          <EBadge tone={leadStatusTone(lead.status)} soft>{titleCase(lead.status)}</EBadge>
        </div>
      ))}
      <Link className="text-[0.75rem] underline" href="/v2/admin/quotes">Pipeline</Link>
    </Card>
  );
}
