/**
 * The job page's right rail: People, Property access, Money, Linked records
 * and the latest client message. Read-only summaries; each links to where the
 * change is made. Money is honest: "Not enough data" (never zero), "Estimate"
 * until payroll, "Locked" once the charge is on an issued invoice.
 */
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import type { ReactNode } from "react";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { messagesHref } from "@/lib/jobs/job-page/primary-action";
import { formatMoney, moneyText, type MoneyFigure } from "@/lib/jobs/job-page/money";
import { JobLinkedActions } from "./job-linked-actions";
import { titleCase, type JobPageData } from "./job-page-data";

function RailCard({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id?: string }) {
  const headingId = `rail-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section id={id} aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3 text-[0.8125rem]">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="e-eyebrow">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Pairs({ children }: { children: ReactNode }) {
  return <dl className="m-0 grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-x-3 gap-y-1">{children}</dl>;
}

function Pair({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[hsl(var(--e-muted-foreground))]">{term}</dt>
      <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function Figure({ figure }: { figure: MoneyFigure }) {
  return figure.kind === "amount" ? <span className="tabular-nums">{formatMoney(figure.amount)}</span> : <span className="text-[hsl(var(--e-muted-foreground))]">{figure.reason}</span>;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function PeopleCard({ data }: { data: JobPageData }) {
  const { job, related } = data;
  const client = job.property?.client ?? null;
  const qaName = related.qaAssignment?.assignedTo?.name ?? related.qaAssignment?.assignedTo?.email ?? null;
  return (
    <RailCard title="People" action={job.status !== "CANCELLED" && !data.viewer.readOnly ? <Link href="#dispatch-change" className="text-[hsl(var(--e-accent-portal))] hover:underline">Change</Link> : null}>
      {job.assignments.length === 0 ? (
        <p className="text-[hsl(var(--e-muted-foreground))]">{job.status === "CANCELLED" ? "No cleaner (released)" : "No cleaner yet"}</p>
      ) : (
        job.assignments.map((assignment) => {
          const name = assignment.user?.name ?? assignment.user?.email ?? "Cleaner";
          return (
            <div key={assignment.id} className="flex items-center gap-2.5">
              <span aria-hidden className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-[hsl(var(--e-primary-soft))] text-[0.6875rem] font-[600] text-[hsl(var(--e-primary))]">{initials(name)}</span>
              <div className="min-w-0">
                <span className="font-[600]">{name}</span> {assignment.isPrimary ? <EBadge tone="neutral">Primary</EBadge> : null}
                <div className="text-[hsl(var(--e-muted-foreground))]">
                  {assignment.user?.phone ? <a href={`tel:${assignment.user.phone}`} className="hover:underline">{assignment.user.phone}</a> : "No phone"} · {titleCase(String(assignment.responseStatus))}
                </div>
              </div>
            </div>
          );
        })
      )}
      <div className="h-px bg-[hsl(var(--e-border))]" />
      <Pairs>
        <Pair term="Client">
          {client ? (
            <>
              <Link href={`/v2/admin/clients/${client.id}`} className="font-[550] text-[hsl(var(--e-accent-portal))] hover:underline">{client.name}</Link>
              <div className="text-[hsl(var(--e-muted-foreground))]">
                {client.phone ? <a href={`tel:${client.phone}`} className="hover:underline">{client.phone}</a> : null}
                {client.phone && client.email ? " · " : null}
                {client.email ? <a href={`mailto:${client.email}`} className="hover:underline">{client.email}</a> : null}
              </div>
            </>
          ) : (
            <span className="text-[hsl(var(--e-muted-foreground))]">No client</span>
          )}
        </Pair>
        <Pair term="QA inspector">{qaName ?? <span className="text-[hsl(var(--e-muted-foreground))]">Not assigned</span>}</Pair>
      </Pairs>
    </RailCard>
  );
}

function AccessCard({ data }: { data: JobPageData }) {
  const property = data.job.property;
  if (!property) return null;
  const info = property.accessInfo && typeof property.accessInfo === "object" ? (property.accessInfo as Record<string, unknown>) : {};
  const keyPickup = data.model.meta.serviceContext?.keyPickupLocation ?? property.keyLocation ?? null;
  return (
    <RailCard title="Property access" action={<Link href={`/v2/admin/properties/${property.id}`} className="text-[hsl(var(--e-accent-portal))] hover:underline">Access guide</Link>}>
      <Pairs>
        <Pair term="Address">{[property.address, property.suburb].filter(Boolean).join(", ") || "Not recorded"}</Pair>
        <Pair term="Lockbox">{asText(info.lockbox) ?? <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span>}</Pair>
        <Pair term="Codes"><span className="text-[hsl(var(--e-muted-foreground))]">Kept on the property&apos;s access guide</span></Pair>
        <Pair term="Parking">{asText(info.parking) ?? <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span>}</Pair>
        <Pair term="Key pickup">{keyPickup ?? <span className="text-[hsl(var(--e-muted-foreground))]">Not recorded</span>}</Pair>
        <Pair term="Check-in tag">{property.requireNfcCheckIn ? "NFC tag required" : "Not required"}</Pair>
        {property.accessNotes ? <Pair term="Notes">{property.accessNotes}</Pair> : null}
      </Pairs>
    </RailCard>
  );
}

function MoneyCard({ data }: { data: JobPageData }) {
  const money = data.model.money;
  const locked = money.chargeState === "locked";
  return (
    <RailCard title="Money" id="money" action={<Link href="#billing" className="text-[hsl(var(--e-accent-portal))] hover:underline">Edit billing</Link>}>
      <Pairs>
        <Pair term="Client charge">
          <span className="font-[600]"><Figure figure={money.charge} /></span>{" "}
          {locked ? <EBadge tone="gold" soft>Locked</EBadge> : money.chargeState === "no-rate" ? <EBadge tone="warning" soft>No rate</EBadge> : null}
        </Pair>
        <Pair term="Cleaner pay">
          <Figure figure={money.pay} /> {money.pay.kind === "amount" ? <EBadge tone="warning" soft>Estimate</EBadge> : null}
        </Pair>
        <Pair term="Margin">
          {money.margin.kind === "amount" ? (
            <span className={money.margin.amount < 0 ? "text-[hsl(var(--e-danger))]" : undefined}>
              {moneyText(money.margin)}{money.marginPercent != null ? ` · ${money.marginPercent}%` : ""}
            </span>
          ) : (
            <Figure figure={money.margin} />
          )}
        </Pair>
      </Pairs>
      {money.payLines.length > 0 ? (
        <ul className="space-y-0.5 text-[hsl(var(--e-muted-foreground))]">
          {money.payLines.map((line) => (
            <li key={line.userId}>
              {line.name.split(" ")[0]} {line.basis}
              {line.transport > 0 ? ` + ${formatMoney(line.transport)} transport` : ""}
              {line.base.kind === "amount" ? ` = ${formatMoney(line.base.amount + line.transport)}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {locked ? <p className="text-[hsl(var(--e-muted-foreground))]">The charge is on an issued invoice. Corrections go through Reissue or Credit note on the invoice.</p> : null}
      <p className="text-[hsl(var(--e-muted-foreground))]">Pay is an estimate (hours × rate, or fixed pay); actuals settle at payroll from clocked time. The pay ledger is in Invoice and pay.</p>
    </RailCard>
  );
}

function LinkedCard({ data }: { data: JobPageData }) {
  const { related, job, model } = data;
  const linkClass = "text-[hsl(var(--e-accent-portal))] hover:underline";
  const invoice = model.liveInvoice;
  return (
    <RailCard title="Linked">
      <Pairs>
        {related.links.quotes ? (
          <Pair term="Quote">{related.quote ? <><Link href={`/v2/admin/quotes/${related.quote.id}`} className={linkClass}>Open quote</Link> <EBadge tone="neutral" soft>{titleCase(String(related.quote.status))}</EBadge></> : <span className="text-[hsl(var(--e-muted-foreground))]">None</span>}</Pair>
        ) : null}
        <Pair term="Cases">
          {job.issueTickets.length === 0 ? <span className="text-[hsl(var(--e-muted-foreground))]">None linked</span> : job.issueTickets.map((ticket) => (
            <span key={ticket.id} className="block">
              {related.links.cases ? <Link href={`/v2/admin/cases/${ticket.id}`} className={linkClass}>{ticket.title}</Link> : ticket.title}{" "}
              <EBadge tone={String(ticket.state) === "RESOLVED" || ticket.status === "RESOLVED" ? "success" : "info"} soft>{titleCase(String(ticket.state ?? ticket.status))}</EBadge>
            </span>
          ))}
        </Pair>
        {related.links.lostFound ? (
          <Pair term="Lost items">
            {related.lostItems === null ? <span className="text-[hsl(var(--e-muted-foreground))]">Could not load</span> : related.lostItems.length === 0 ? <span className="text-[hsl(var(--e-muted-foreground))]">None</span> : related.lostItems.map((item) => (
              <span key={item.id} className="block"><Link href={`/v2/admin/lost-found?open=${encodeURIComponent(item.id)}`} className={linkClass}>{item.itemName}</Link> <EBadge tone="info" soft>{titleCase(String(item.status))}</EBadge></span>
            ))}
          </Pair>
        ) : null}
        {related.links.urgentStock ? (
          <Pair term="Urgent needs">
            {related.urgentNeeds === null ? <span className="text-[hsl(var(--e-muted-foreground))]">Could not load</span> : related.urgentNeeds.length === 0 ? <span className="text-[hsl(var(--e-muted-foreground))]">None</span> : related.urgentNeeds.map((need) => (
              <span key={need.id} className="block">
                <Link href={`/v2/admin/inventory?tab=urgent-stock&open=${encodeURIComponent(need.id)}`} className={linkClass}>
                  {need.itemName}{need.observedCount != null ? `, ${need.observedCount} ${need.unit} left` : ""}
                </Link>{" "}
                <EBadge tone="warning" soft>{titleCase(need.stage)}</EBadge>
              </span>
            ))}
          </Pair>
        ) : null}
        <Pair term="Invoice">
          {invoice ? <Link href={`/v2/admin/finance/invoices/${encodeURIComponent(invoice.id)}`} className={linkClass}>{invoice.invoiceNumber ?? "Invoice"}</Link> : <span className="text-[hsl(var(--e-muted-foreground))]">Not invoiced yet</span>}
        </Pair>
      </Pairs>
      <JobLinkedActions canCase={related.links.cases && !data.viewer.readOnly} canLostItem={related.links.lostFound && !data.viewer.readOnly} timeZone={data.timeZone} />
    </RailCard>
  );
}

function MessagesCard({ data }: { data: JobPageData }) {
  const latest = data.related.latestClientMessage;
  return (
    <RailCard title="Client messages">
      {latest ? (
        <p className="[overflow-wrap:anywhere]">
          “{latest.body.length > 160 ? `${latest.body.slice(0, 157)}…` : latest.body}”{" "}
          <span className="text-[hsl(var(--e-muted-foreground))]">{formatInTimeZone(latest.createdAt, data.timeZone, "d MMM HH:mm")}</span>
        </p>
      ) : (
        <p className="text-[hsl(var(--e-muted-foreground))]">No messages from the client on this job.</p>
      )}
      <div>
        <EButton asChild size="sm" variant="outline"><Link href={messagesHref(data.job.id)}>{latest ? "Reply or relay to cleaner" : "Open messages"}</Link></EButton>
      </div>
    </RailCard>
  );
}

export function JobRail({ data }: { data: JobPageData }) {
  return (
    <aside aria-label="Job details" className="flex w-full min-w-0 flex-col gap-3 lg:w-[340px] lg:flex-none">
      <PeopleCard data={data} />
      <AccessCard data={data} />
      <MoneyCard data={data} />
      <LinkedCard data={data} />
      <MessagesCard data={data} />
    </aside>
  );
}
