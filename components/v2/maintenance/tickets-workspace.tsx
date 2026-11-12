"use client";

import { useRestorableState } from "@/hooks/use-restorable-state";

import Link from "next/link";
import * as React from "react";
import { useMemo, useState } from "react";
import { CalendarClock, ChevronRight, Columns3, List } from "lucide-react";
import { EAlert, EBadge, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { MAINTENANCE_STAGES, maintenanceScheduleLabel, maintenanceVisitStage, type MaintenanceTicketSummary } from "@/lib/maintenance/ticket-stage";
import { groupTicketsByDay } from "@/lib/maintenance/tickets-by-day";

const PRIORITY_LABEL: Record<string, string> = { URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
const PRIORITY_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  URGENT: "danger",
  HIGH: "warning",
  MEDIUM: "info",
  LOW: "neutral",
};

/** The whole card opens the visit; the link's name stays the ticket title. */
function TicketCard({ ticket }: { ticket: MaintenanceTicketSummary }) {
  const approval = ticket.costApprovalStatus;
  const location = [ticket.property?.name ?? "Property", ticket.property?.suburb].filter(Boolean).join(", ");
  return (
    <ECard className="relative transition-colors hover:border-[hsl(var(--e-border-strong))] focus-within:border-[hsl(var(--e-ring))]">
      <ECardBody className="flex items-start gap-3 p-4 pt-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <Link
              href={`/v2/maintenance/visits/${ticket.id}`}
              className="block text-[0.9375rem] font-[600] leading-snug text-[hsl(var(--e-foreground))] [overflow-wrap:anywhere] after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
            >
              {ticket.title}
            </Link>
            <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{location}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <EBadge soft tone={PRIORITY_TONE[ticket.priority] ?? "neutral"}>
              {PRIORITY_LABEL[ticket.priority] ?? ticket.priority}
            </EBadge>
            <EBadge soft tone="neutral">
              {MAINTENANCE_STAGES[ticket.status as keyof typeof MAINTENANCE_STAGES] ?? ticket.status}
            </EBadge>
            <EBadge soft tone={ticket.status === "RESOLVED" ? "success" : "neutral"}>
              {maintenanceVisitStage(ticket)}
            </EBadge>
          </div>
          {approval === "PENDING" ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-warning))]">
              Awaiting cost approval. Review the quote decision before committing work.
            </p>
          ) : approval === "DECLINED" ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
              Cost declined. Contact operations about the next step.
            </p>
          ) : null}
          <p className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {maintenanceScheduleLabel(ticket.scheduledFor)}
          </p>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" aria-hidden />
      </ECardBody>
    </ECard>
  );
}

function ViewToggle({ view, onChange }: { view: "list" | "board"; onChange: (view: "list" | "board") => void }) {
  const option = (value: "list" | "board", label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => onChange(value)}
      className={
        "inline-flex min-h-10 items-center gap-1.5 rounded-[var(--e-radius)] px-3 text-[0.8125rem] font-[550] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))] " +
        (view === value
          ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
          : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
      }
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Ticket view"
      className="inline-flex gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1"
    >
      {option("list", "By day", <List className="h-4 w-4" aria-hidden />)}
      {option("board", "By stage", <Columns3 className="h-4 w-4" aria-hidden />)}
    </div>
  );
}

export function MaintenanceTicketsWorkspace({ tickets, page = 1, totalCount = tickets?.length ?? null }: { tickets: MaintenanceTicketSummary[] | null; page?: number; totalCount?: number | null }) {
  const [view, setView] = useRestorableState<"list" | "board">("tickets-workspace:view", "list");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useRestorableState("tickets-workspace:search", "");
  const filtered = useMemo(() => (tickets ?? []).filter((ticket) => {
    if (status !== "all" && ticket.status !== status) return false;
    const text = [ticket.title, ticket.property?.name, ticket.property?.suburb].filter(Boolean).join(" ").toLowerCase();
    return text.includes(search.trim().toLowerCase());
  }), [tickets, status, search]);
  const statuses = Array.from(new Set([...Object.keys(MAINTENANCE_STAGES), ...(tickets ?? []).map((ticket) => ticket.status)]));

  if (tickets === null) return (
    <div role="alert">
      <EAlert tone="danger" title="Maintenance tickets are unavailable.">
        <a href="/v2/maintenance/tickets" className="font-[550] underline underline-offset-2">Retry tickets</a>
      </EAlert>
    </div>
  );

  return <div className="space-y-4">
    <ViewToggle view={view} onChange={setView} />
    <div className="grid gap-2 sm:grid-cols-2">
      <EInput aria-label="Search tickets" placeholder="Search ticket or property" value={search} onChange={(event) => setSearch(event.target.value)} />
      <ESelect aria-label="Work order status" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="all">All statuses</option>
        {statuses.map((key) => <option key={key} value={key}>{MAINTENANCE_STAGES[key as keyof typeof MAINTENANCE_STAGES] ?? key}</option>)}
      </ESelect>
    </div>
    <p role="status" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Showing {filtered.length} of {tickets.length} tickets on page {page}. Total: {totalCount ?? "unavailable"}.</p>
    {totalCount === null ? <p role="alert" className="text-sm">The overall ticket count is unavailable. <a href={`/v2/maintenance/tickets?page=${page}`} className="underline">Retry count</a></p> : null}
    <nav aria-label="Ticket pages" className="flex gap-4 text-[0.8125rem] font-[550]">
      {page > 1 ? <Link className="underline" href={`/v2/maintenance/tickets?page=${page - 1}`}>Previous page</Link> : null}
      {(totalCount === null ? tickets.length === 50 : page * 50 < totalCount) ? <Link className="underline" href={`/v2/maintenance/tickets?page=${page + 1}`}>Next page</Link> : null}
    </nav>
    {tickets.length === 0 ? <EEmptyState title={page === 1 ? "No tickets" : "No tickets on this page"} description={page === 1 ? "Maintenance requests will appear here." : "Return to a previous page to view tickets."} />
      : filtered.length === 0 ? <EEmptyState title="No matching tickets" description="Change the search or status filter." />
      : view === "list" ? <div className="space-y-5">
        {/* Board "By day": today first, then each later day, then past and unscheduled work. */}
        {groupTicketsByDay(filtered).map((group) => <div key={group.key} className="space-y-2">
          <h2 className="e-eyebrow">{group.label} <span className="e-tnum">({group.tickets.length})</span></h2>
          <div className="space-y-3">{group.tickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)}</div>
        </div>)}
      </div>
      : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {statuses.filter((key) => status === "all" || key === status).map((key) => {
          const items = filtered.filter((ticket) => ticket.status === key);
          const label = MAINTENANCE_STAGES[key as keyof typeof MAINTENANCE_STAGES] ?? key;
          return <section key={key} aria-label={`${label} tickets`} className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
            <h2 className="flex items-center justify-between text-[0.8125rem] font-[600]">
              {label} ({items.length})
            </h2>
            {items.length ? items.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />) : <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No tickets in this stage.</p>}
          </section>;
        })}
      </div>}
  </div>;
}
