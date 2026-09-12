"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { MAINTENANCE_STAGES, maintenanceScheduleLabel, maintenanceVisitStage, type MaintenanceTicketSummary } from "@/lib/maintenance/ticket-stage";

function TicketCard({ ticket }: { ticket: MaintenanceTicketSummary }) {
  const approval = ticket.costApprovalStatus;
  return <ECard><ECardBody className="space-y-2 pt-6">
    <Link href={`/v2/maintenance/visits/${ticket.id}`} className="block font-medium underline underline-offset-4">{ticket.title}</Link>
    <p className="text-sm text-[hsl(var(--e-muted-foreground))]">{[ticket.property?.name ?? "Property", ticket.property?.suburb].filter(Boolean).join(", ")}</p>
    <div className="flex flex-wrap gap-2">
      <EBadge soft tone={ticket.priority === "URGENT" ? "danger" : ticket.priority === "HIGH" ? "warning" : "neutral"}>{ticket.priority.toLowerCase()}</EBadge>
      <EBadge soft tone="neutral">{MAINTENANCE_STAGES[ticket.status as keyof typeof MAINTENANCE_STAGES] ?? ticket.status}</EBadge>
      <EBadge soft tone={ticket.status === "RESOLVED" ? "success" : "neutral"}>{maintenanceVisitStage(ticket)}</EBadge>
    </div>
    {approval === "PENDING" ? <p className="text-sm">Awaiting cost approval. Review the quote decision before committing work.</p> : approval === "DECLINED" ? <p className="text-sm">Cost declined. Contact operations about the next step.</p> : null}
    <p className="text-xs text-[hsl(var(--e-muted-foreground))]">{maintenanceScheduleLabel(ticket.scheduledFor)}</p>
  </ECardBody></ECard>;
}

export function MaintenanceTicketsWorkspace({ tickets, page = 1, totalCount = tickets?.length ?? null }: { tickets: MaintenanceTicketSummary[] | null; page?: number; totalCount?: number | null }) {
  const [view, setView] = useState<"list" | "board">("list");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => (tickets ?? []).filter((ticket) => {
    if (status !== "all" && ticket.status !== status) return false;
    const text = [ticket.title, ticket.property?.name, ticket.property?.suburb].filter(Boolean).join(" ").toLowerCase();
    return text.includes(search.trim().toLowerCase());
  }), [tickets, status, search]);
  const statuses = Array.from(new Set([...Object.keys(MAINTENANCE_STAGES), ...(tickets ?? []).map((ticket) => ticket.status)]));

  if (tickets === null) return <div role="alert" className="rounded border border-red-600 p-4">
    <p>Maintenance tickets are unavailable.</p>
    <a href="/v2/maintenance/tickets" className="underline">Retry tickets</a>
  </div>;

  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Ticket view">
      <EButton variant="outline" aria-pressed={view === "list"} onClick={() => setView("list")}>List view</EButton>
      <EButton variant="outline" aria-pressed={view === "board"} onClick={() => setView("board")}>Board view</EButton>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      <EInput aria-label="Search tickets" placeholder="Search ticket or property" value={search} onChange={(event) => setSearch(event.target.value)} />
      <ESelect aria-label="Work order status" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="all">All statuses</option>
        {statuses.map((key) => <option key={key} value={key}>{MAINTENANCE_STAGES[key as keyof typeof MAINTENANCE_STAGES] ?? key}</option>)}
      </ESelect>
    </div>
    <p role="status" className="text-sm">Showing {filtered.length} of {tickets.length} tickets on page {page}. Total: {totalCount ?? "unavailable"}. Search, status filters and board counts apply to this page.</p>
    {totalCount === null ? <p role="alert" className="text-sm">The overall ticket count is unavailable. <a href={`/v2/maintenance/tickets?page=${page}`} className="underline">Retry count</a></p> : null}
    <nav aria-label="Ticket pages" className="flex gap-4 text-sm">
      {page > 1 ? <Link className="underline" href={`/v2/maintenance/tickets?page=${page - 1}`}>Previous page</Link> : null}
      {(totalCount === null ? tickets.length === 50 : page * 50 < totalCount) ? <Link className="underline" href={`/v2/maintenance/tickets?page=${page + 1}`}>Next page</Link> : null}
    </nav>
    {tickets.length === 0 ? <EEmptyState title={page === 1 ? "No tickets" : "No tickets on this page"} description={page === 1 ? "Maintenance requests will appear here." : "Return to a previous page to view tickets."} />
      : filtered.length === 0 ? <EEmptyState title="No matching tickets" description="Change the search or status filter." />
      : view === "list" ? <div className="space-y-3">{filtered.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)}</div>
      : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {statuses.filter((key) => status === "all" || key === status).map((key) => {
          const items = filtered.filter((ticket) => ticket.status === key);
          const label = MAINTENANCE_STAGES[key as keyof typeof MAINTENANCE_STAGES] ?? key;
          return <section key={key} aria-label={`${label} tickets`} className="space-y-3 rounded border p-3">
            <h2 className="font-semibold">{label} ({items.length})</h2>
            {items.length ? items.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />) : <p className="text-sm">No tickets in this stage.</p>}
          </section>;
        })}
      </div>}
  </div>;
}
