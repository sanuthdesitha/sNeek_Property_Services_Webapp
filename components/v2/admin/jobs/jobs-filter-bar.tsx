"use client";

/**
 * The visible Jobs filters (search, Date, Status, Client, Cleaner, Job type,
 * Invoice, Clear) and the display switches (List | Board, Columns). Each
 * filter is a chip that names its current value, so an active filter stays
 * visible while its panel is closed.
 */
import { Search } from "lucide-react";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EButton } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import { JOBS_DATE_SCOPES } from "@/lib/jobs/date-scope";
import { defaultJobsFilters, pickJobsFilters, JOBS_FILTER_KEYS } from "@/lib/jobs/view-presets";
import type { JobsWorkspaceState } from "@/lib/jobs/workspace-state";
import { JobsStatusFilter, statusFilterLabel } from "./jobs-status-filter";
import { jobTypeLabel } from "./job-row";
import { JOB_TYPE_VALUES } from "./jobs-constants";
import type { JobsReferenceData } from "./use-jobs-reference-data";

const FIELD = "h-9 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2 text-[0.8125rem] text-[hsl(var(--e-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";
const LABEL = "block text-[0.6875rem] font-[600] text-[hsl(var(--e-text-secondary))]";

type FilterBarProps = {
  state: JobsWorkspaceState;
  update: (patch: Partial<JobsWorkspaceState>) => void;
  reference: JobsReferenceData;
  optionsOpen: boolean;
  onToggleOptions: () => void;
};

function dateValue(state: JobsWorkspaceState): string | null {
  if (state.dateFrom || state.dateTo) return `${state.dateFrom || "…"} – ${state.dateTo || "…"}`;
  if (state.dateScope === "all") return null;
  return JOBS_DATE_SCOPES.find((scope) => scope.id === state.dateScope)?.label ?? null;
}

function optionName(list: Array<{ id: string; name: string }>, id: string, fallback: string): string {
  return list.find((item) => item.id === id)?.name || fallback;
}

export function hasActiveFilters(state: JobsWorkspaceState): boolean {
  const defaults = defaultJobsFilters();
  const current = pickJobsFilters(state);
  return JOBS_FILTER_KEYS.some((key) => current[key] !== defaults[key]);
}

export function JobsFilterBar({ state, update, reference, optionsOpen, onToggleOptions }: FilterBarProps) {
  const { clients, properties, cleaners } = reference;
  const cleanerValue = state.cleanerId === "all" ? null : state.cleanerId === "unassigned" ? "Nobody assigned" : optionName(cleaners, state.cleanerId, "Selected cleaner");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative w-full sm:w-[240px]">
        <span className="sr-only">Search jobs</span>
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
        <input
          aria-label="Search jobs"
          value={state.search}
          maxLength={200}
          onChange={(event) => update({ search: event.target.value })}
          placeholder="Search property, client, cleaner, job no."
          className={cn(FIELD, "pl-8")}
        />
      </label>

      <EFilterPopover label="Date" value={dateValue(state)}>
        <fieldset className="space-y-1">
          <legend className={LABEL}>Shortcut</legend>
          {JOBS_DATE_SCOPES.map((scope) => (
            <label key={scope.id} className="flex min-h-8 items-center gap-2 text-[0.8125rem]">
              <input type="radio" name="jobs-date-scope" checked={!state.dateFrom && !state.dateTo && state.dateScope === scope.id}
                onChange={() => update({ dateScope: scope.id, dateFrom: "", dateTo: "" })} />
              {scope.label}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>From<input type="date" aria-label="Scheduled from date" value={state.dateFrom} onChange={(event) => update({ dateFrom: event.target.value })} className={cn(FIELD, "mt-1")} /></label>
          <label className={LABEL}>To<input type="date" aria-label="Scheduled to date" value={state.dateTo} onChange={(event) => update({ dateTo: event.target.value })} className={cn(FIELD, "mt-1")} /></label>
        </div>
        <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">A custom range replaces the shortcut.</p>
      </EFilterPopover>

      <EFilterPopover label="Status" value={statusFilterLabel(state.statusChip)}>
        <JobsStatusFilter value={state.statusChip} onChange={(statusChip) => update({ statusChip })} />
      </EFilterPopover>

      <EFilterPopover label="Client" value={state.clientId === "all" ? null : optionName(clients, state.clientId, "Selected client")}>
        <label className={LABEL}>Client
          <select aria-label="Filter by client" value={state.clientId} onChange={(event) => update({ clientId: event.target.value })} className={cn(FIELD, "mt-1")}>
            <option value="all">All clients</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name || client.id}</option>)}
          </select>
        </label>
        <label className={LABEL}>Property
          <select aria-label="Filter by property" value={state.propertyId} onChange={(event) => update({ propertyId: event.target.value })} className={cn(FIELD, "mt-1")}>
            <option value="all">All properties</option>
            {properties.map((property) => <option key={property.id} value={property.id}>{property.name || property.id}{property.suburb ? ` · ${property.suburb}` : ""}</option>)}
          </select>
        </label>
        {reference.state.clients === "error" || reference.state.properties === "error" ? <p role="alert" className="text-[0.75rem]">Some options could not load. Reload the page to try again.</p> : null}
      </EFilterPopover>
      {state.propertyId !== "all" ? (
        <button type="button" className={cn(E_CHIP_CLASS, E_CHIP_ON_CLASS)} onClick={() => update({ propertyId: "all" })} aria-label="Remove property filter">
          Property: {optionName(properties, state.propertyId, "Selected property")} ✕
        </button>
      ) : null}

      <EFilterPopover label="Cleaner" value={cleanerValue}>
        <label className={LABEL}>Cleaner
          <select aria-label="Filter by assigned cleaner" value={state.cleanerId} onChange={(event) => update({ cleanerId: event.target.value })} className={cn(FIELD, "mt-1")}>
            <option value="all">Any cleaner</option>
            <option value="unassigned">Nobody assigned</option>
            {cleaners.map((cleaner) => <option key={cleaner.id} value={cleaner.id}>{cleaner.name || cleaner.email || cleaner.id}</option>)}
          </select>
        </label>
        {reference.state.cleaners === "error" ? <p role="alert" className="text-[0.75rem]">Cleaners could not load. Reload the page to try again.</p> : null}
      </EFilterPopover>

      <EFilterPopover label="Job type" value={state.jobType === "all" ? null : jobTypeLabel(state.jobType)}>
        <label className={LABEL}>Job type
          <select aria-label="Filter by job type" value={state.jobType} onChange={(event) => update({ jobType: event.target.value })} className={cn(FIELD, "mt-1")}>
            <option value="all">All types</option>
            {JOB_TYPE_VALUES.map((value) => <option key={value} value={value}>{jobTypeLabel(value)}</option>)}
          </select>
        </label>
      </EFilterPopover>

      <EFilterPopover label="Invoice" value={state.invoiced === "yes" ? "Invoiced" : state.invoiced === "no" ? "Not invoiced" : null}>
        <label className={LABEL}>Invoice
          <select aria-label="Filter by invoice status" value={state.invoiced} onChange={(event) => update({ invoiced: event.target.value })} className={cn(FIELD, "mt-1")}>
            <option value="all">Any invoice status</option>
            <option value="yes">Invoiced</option>
            <option value="no">Not invoiced</option>
          </select>
        </label>
        <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Invoiced means the job is marked invoiced or has a line on an invoice that is not void.</p>
      </EFilterPopover>

      <EButton variant="ghost" size="sm" disabled={!hasActiveFilters(state)} onClick={() => update(defaultJobsFilters())}>Clear filters</EButton>

      <span className="hidden min-w-0 flex-1 sm:block" />
      <div role="group" aria-label="Layout" className="flex items-center gap-1.5">
        <button type="button" aria-pressed={state.view === "list"} onClick={() => update({ view: "list" })} className={cn(E_CHIP_CLASS, state.view === "list" && E_CHIP_ON_CLASS)}>List</button>
        <button type="button" aria-pressed={state.view === "board"} onClick={() => update({ view: "board" })} className={cn(E_CHIP_CLASS, state.view === "board" && E_CHIP_ON_CLASS)}>Board</button>
      </div>
      <button type="button" aria-expanded={optionsOpen} aria-controls="jobs-view-options" onClick={onToggleOptions} className={cn(E_CHIP_CLASS, optionsOpen && E_CHIP_ON_CLASS)}>
        Columns
      </button>
    </div>
  );
}
