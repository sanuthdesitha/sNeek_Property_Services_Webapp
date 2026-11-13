"use client";

/**
 * The case list column: select-all, sort, filters, one card per case and paging.
 * Cards show title, SLA pill, client · property · job or invoice reference,
 * type, state flags (client replied, unowned, waiting on client) and owner.
 */
import * as React from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { EPill } from "@/components/v2/ui/pill";
import { EPagination } from "@/components/v2/ui/pagination";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { CASE_STATUSES, CASE_STATUS_LABELS } from "@/lib/cases/status";
import { CASE_TYPES } from "@/lib/cases/queues";
import { CASE_PAGE_SIZE_CLIENT } from "./case-url-state";
import {
  CASE_TYPE_LABELS,
  SORT_OPTIONS,
  personLabel,
  slaPill,
  type AssigneeOption,
  type CaseListFilters,
  type CaseSort,
  type CaseSummary,
  type CaseTypeCounts,
  type CaseViewer,
} from "./case-types";
import type { CaseListStatus } from "./use-case-list";

type Props = {
  rows: CaseSummary[];
  status: CaseListStatus;
  error: string;
  refreshFailed: boolean;
  total: number;
  page: number;
  sort: CaseSort;
  dir: "asc" | "desc";
  filters: CaseListFilters;
  assignees: AssigneeOption[];
  viewer: CaseViewer | null;
  openId: string | null;
  selected: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], select: boolean) => void;
  onSort: (sort: CaseSort, dir: "asc" | "desc") => void;
  onFilters: (patch: Partial<CaseListFilters>) => void;
  onPage: (page: number) => void;
  onRetry: () => void;
  /** Manual Refresh (restored from the old screen): list, counts and the open case. */
  onRefresh?: () => void;
  className?: string;
  /** Phones: the Type filter (the rail's Type chips) inside Filters. */
  typeFilter?: { caseType: string; typeCounts: CaseTypeCounts | null; onType: (caseType: string) => void };
};

function referenceLine(row: CaseSummary): string {
  const parts = [row.client?.name, row.property?.name, row.job?.jobNumber ?? (row.jobId ? "Linked job" : null), row.invoiceRef];
  const text = parts.filter(Boolean).join(" · ");
  return text || "Not linked to a client, property or job";
}

function CaseCard({ row, active, checked, viewerId, nowMs, onOpen, onToggle }: {
  row: CaseSummary; active: boolean; checked: boolean; viewerId: string | null; nowMs: number;
  onOpen: () => void; onToggle: () => void;
}) {
  const sla = slaPill(row, nowMs);
  const owner = row.assignedTo ? (row.assignedTo.id === viewerId ? "you" : personLabel(row.assignedTo)) : null;
  return (
    <li className={cn("flex gap-2.5 border-b border-[hsl(var(--e-border))] px-3.5 py-3", active && "bg-[hsl(var(--e-primary-soft))]")}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={checked} onChange={onToggle} aria-label={`Select ${row.title}`} />
      <button type="button" onClick={onOpen} aria-current={active ? "true" : undefined} className="flex min-w-0 flex-1 flex-col gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
        <span className="flex items-start justify-between gap-2">
          <b className="min-w-0 break-words text-[0.875rem]">{row.title}</b>
          {sla ? <EPill tone={sla.tone}>{sla.label}</EPill> : <EPill tone="ok">{CASE_STATUS_LABELS[row.status]}</EPill>}
        </span>
        <span className="break-words text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{referenceLine(row)}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <EPill tone={row.caseType === "DAMAGE" ? "warn" : "neutral"}>{CASE_TYPE_LABELS[row.caseType]}</EPill>
          {row.clientReplied ? <EPill tone="info">Client replied</EPill> : null}
          {!row.assignedTo ? <EPill tone="bad">Unowned</EPill> : null}
          {row.status === "WAITING_CLIENT" ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Waiting on client</span> : null}
          {owner ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Owner: {owner}</span> : null}
        </span>
      </button>
    </li>
  );
}

function ListFilters({ filters, assignees, onFilters, typeFilter }: Pick<Props, "filters" | "assignees" | "onFilters" | "typeFilter">) {
  const active = [filters.status, filters.assigneeUserId, filters.jobId, filters.reportId, typeFilter?.caseType].filter(Boolean).length;
  return (
    <EFilterPopover label="Filters" value={active ? `${active} on` : null}>
      {typeFilter ? (
        <EField label="Type">
          <ESelect value={typeFilter.caseType} onChange={(event) => typeFilter.onType(event.target.value)}>
            <option value="">All types</option>
            {CASE_TYPES.map((type) => (
              <option key={type} value={type}>{CASE_TYPE_LABELS[type]}{typeFilter.typeCounts ? ` (${typeFilter.typeCounts[type]})` : ""}</option>
            ))}
          </ESelect>
        </EField>
      ) : null}
      <EField label="Status">
        <ESelect value={filters.status} onChange={(event) => onFilters({ status: event.target.value })}>
          <option value="">All statuses</option>
          {CASE_STATUSES.map((status) => <option key={status} value={status}>{CASE_STATUS_LABELS[status]}</option>)}
        </ESelect>
      </EField>
      <EField label="Owner">
        <ESelect value={filters.assigneeUserId} onChange={(event) => onFilters({ assigneeUserId: event.target.value })}>
          <option value="">All owners</option>
          <option value="__unassigned">Unassigned</option>
          {assignees.map((person) => <option key={person.id} value={person.id}>{personLabel(person)}</option>)}
        </ESelect>
      </EField>
      <EField label="Job id">
        <EInput value={filters.jobId} onChange={(event) => onFilters({ jobId: event.target.value.trim() })} placeholder="Filter by job id" />
      </EField>
      {filters.reportId ? (
        <EButton size="sm" variant="outline" onClick={() => onFilters({ reportId: "" })}>Clear report filter</EButton>
      ) : null}
    </EFilterPopover>
  );
}

export function CaseList(props: Props) {
  const { rows, status, error, refreshFailed, total, page, sort, dir, viewer, openId, selected, onToggleAll, onSort, onPage, onRetry } = props;
  const sortId = React.useId();
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => setNowMs(Date.now()), [rows]);
  const pageIds = rows.map((row) => row.id);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const sortValue = `${sort}:${dir}`;

  return (
    <section aria-label="Case list" className={cn("flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] lg:w-[360px] lg:shrink-0 lg:rounded-r-none", props.className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-3.5 py-2.5">
        <label className="inline-flex items-center gap-2 text-[0.8125rem]">
          <input type="checkbox" className="h-4 w-4" checked={allChecked} disabled={pageIds.length === 0} onChange={(event) => onToggleAll(pageIds, event.target.checked)} />
          Select
        </label>
        <div className="flex items-center gap-1.5">
          {props.onRefresh ? (
            <button
              type="button"
              onClick={props.onRefresh}
              aria-busy={status === "loading"}
              className="inline-flex h-7 items-center gap-1 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
            >
              <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", status === "loading" && "animate-spin motion-reduce:animate-none")} />
              {status === "loading" ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
          <ListFilters filters={props.filters} assignees={props.assignees} onFilters={props.onFilters} typeFilter={props.typeFilter} />
          <label htmlFor={sortId} className="sr-only">Sort cases</label>
          <select
            id={sortId}
            value={sortValue}
            onChange={(event) => {
              const option = SORT_OPTIONS.find((item) => `${item.key}:${item.dir}` === event.target.value);
              if (option) onSort(option.key, option.dir);
            }}
            className="h-7 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={`${option.key}:${option.dir}`} value={`${option.key}:${option.dir}`}>Sort: {option.label}</option>
            ))}
          </select>
        </div>
      </div>
      {refreshFailed ? <p role="status" className="px-3.5 py-2 text-[0.75rem] text-[hsl(var(--e-warning))]">Could not refresh; showing the last loaded cases.</p> : null}
      {status === "loading" && rows.length === 0 ? (
        <p className="px-3.5 py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading cases…</p>
      ) : status === "error" ? (
        <div role="alert" className="space-y-2 px-3.5 py-6 text-[0.875rem]">
          <p className="text-[hsl(var(--e-danger))]">{error}</p>
          <EButton size="sm" variant="outline" onClick={onRetry}>Retry</EButton>
        </div>
      ) : rows.length === 0 ? (
        <p className="px-3.5 py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No cases in this queue.</p>
      ) : (
        <ul className={cn("min-h-0 flex-1 overflow-y-auto", status === "loading" && "opacity-60")} aria-busy={status === "loading"}>
          {rows.map((row) => (
            <CaseCard
              key={row.id}
              row={row}
              active={openId === row.id}
              checked={selected.has(row.id)}
              viewerId={viewer?.id ?? null}
              nowMs={nowMs}
              onOpen={() => props.onOpen(row.id)}
              onToggle={() => props.onToggle(row.id)}
            />
          ))}
        </ul>
      )}
      <EPagination className="border-t border-[hsl(var(--e-border))] px-3.5 py-2.5" page={page} pageSize={CASE_PAGE_SIZE_CLIENT} total={total} onPageChange={onPage} noun="cases" disabled={status === "loading"} />
    </section>
  );
}
