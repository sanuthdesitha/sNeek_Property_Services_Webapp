"use client";

/**
 * The page heading and controls, as drawn: "Calendar" with the summary line
 * ("Week of 9 November · 61 jobs · 3 without a cleaner"), Previous / Today /
 * Next, the Day | Week | Month | Agenda switch, then the chip row: Rows:
 * cleaners | Rows: properties, Client, Status, Show laundry runs, Show guest
 * arrivals, and the hint about dragging. A quiet Refresh keeps the previous
 * calendar's manual reload.
 */
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EFilterBar, type EActiveFilter } from "@/components/v2/ui/filter-bar";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { CALENDAR_VIEWS, type CalendarView } from "@/lib/calendar/range";
import {
  CALENDAR_STATUS_GROUPS,
  DEFAULT_CALENDAR_PREFS,
  statusFilterLabel,
  type CalendarStatusFilter,
  type CalendarUrlState,
} from "@/lib/calendar/url-state";
import { STATUS_LABELS } from "@/lib/jobs/status-labels";

const VIEW_LABEL: Record<CalendarView, string> = { day: "Day", week: "Week", month: "Month", agenda: "Agenda" };
const STEP_LABEL: Record<CalendarView, string> = { day: "day", week: "week", month: "month", agenda: "fortnight" };

export type ClientOption = { id: string; name: string };

type ToolbarProps = {
  view: CalendarView;
  state: CalendarUrlState;
  summary: string;
  statusLine: string | null;
  clients: ClientOption[];
  clientsState: "loading" | "ready" | "error";
  statusCounts: Record<string, number> | null;
  unassignedTotal: number | null;
  loading: boolean;
  dragHint: boolean;
  onStep: (direction: 1 | -1) => void;
  onToday: () => void;
  onView: (view: CalendarView) => void;
  update: (patch: Partial<CalendarUrlState>) => void;
  onRefresh: () => void;
  /** Below 640px (`useIsPhone`): the phone layout of the controls. */
  phone?: boolean;
  /** Phones only: the week strip drawn under the heading. */
  weekStrip?: React.ReactNode;
};

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={cn(E_CHIP_CLASS, pressed && E_CHIP_ON_CLASS)}>
      {children}
    </button>
  );
}

function RadioOption({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[0.8125rem]">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-[hsl(var(--e-primary))]" />
      <span>{children}</span>
    </label>
  );
}

function countFor(filter: CalendarStatusFilter, counts: Record<string, number> | null): number | null {
  if (!counts) return null;
  if (filter === "all") return Object.values(counts).reduce((sum, value) => sum + value, 0);
  const group = (CALENDAR_STATUS_GROUPS as Record<string, { statuses: readonly string[] | null }>)[filter];
  const statuses = group ? group.statuses ?? [] : [filter];
  return statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}

/** Phones: the filters that differ from their defaults, as removable chips. */
function calendarActiveFilters(state: CalendarUrlState, clientName: string | null, update: (patch: Partial<CalendarUrlState>) => void): EActiveFilter[] {
  const active: EActiveFilter[] = [];
  if (state.rows !== DEFAULT_CALENDAR_PREFS.rows) active.push({ key: "rows", label: "Rows: properties", onRemove: () => update({ rows: DEFAULT_CALENDAR_PREFS.rows }) });
  if (clientName) active.push({ key: "client", label: `Client: ${clientName}`, onRemove: () => update({ clientId: null }) });
  if (state.status !== "all") active.push({ key: "status", label: `Status: ${statusFilterLabel(state.status)}`, onRemove: () => update({ status: "all" }) });
  if (state.unassigned) active.push({ key: "unassigned", label: "Only jobs without a cleaner", onRemove: () => update({ unassigned: false }) });
  if (state.laundry !== DEFAULT_CALENDAR_PREFS.laundry) active.push({ key: "laundry", label: state.laundry ? "Laundry runs shown" : "Laundry runs hidden", onRemove: () => update({ laundry: DEFAULT_CALENDAR_PREFS.laundry }) });
  if (state.arrivals !== DEFAULT_CALENDAR_PREFS.arrivals) active.push({ key: "arrivals", label: state.arrivals ? "Guest arrivals shown" : "Guest arrivals hidden", onRemove: () => update({ arrivals: DEFAULT_CALENDAR_PREFS.arrivals }) });
  return active;
}

export function CalendarToolbar(props: ToolbarProps) {
  const { view, state, update } = props;
  const phone = props.phone ?? false;
  const clientName = state.clientId ? props.clients.find((client) => client.id === state.clientId)?.name ?? "Selected client" : null;
  const statusValue = state.status !== "all" || state.unassigned
    ? [state.status !== "all" ? statusFilterLabel(state.status) : null, state.unassigned ? "without a cleaner" : null].filter(Boolean).join(", ")
    : null;
  const withCount = (label: string, count: number | null) => (count === null ? label : `${label} (${count})`);
  const activeFilters = calendarActiveFilters(state, clientName, update);
  const clearFilters = () => update({
    rows: DEFAULT_CALENDAR_PREFS.rows, clientId: null, status: "all", unassigned: DEFAULT_CALENDAR_PREFS.unassigned,
    laundry: DEFAULT_CALENDAR_PREFS.laundry, arrivals: DEFAULT_CALENDAR_PREFS.arrivals,
  });

  return (
    <div className="space-y-[14px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-sm:w-full">
          <div className="flex items-center justify-between gap-3">
            <h1 className="e-display-md">Calendar</h1>
            {phone ? <EButton variant="outline" size="sm" onClick={props.onToday}>Today</EButton> : null}
          </div>
          {phone ? null : <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] max-sm:hidden">{props.summary}</p>}
          {props.statusLine ? <p role="status" className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{props.statusLine}</p> : null}
        </div>
        {phone ? null : <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 max-sm:hidden">
          <EButton variant="outline" size="sm" aria-label={`Previous ${STEP_LABEL[view]}`} onClick={() => props.onStep(-1)}><ChevronLeft aria-hidden className="h-4 w-4" /></EButton>
          <EButton variant="outline" size="sm" onClick={props.onToday}>Today</EButton>
          <EButton variant="outline" size="sm" aria-label={`Next ${STEP_LABEL[view]}`} onClick={() => props.onStep(1)}><ChevronRight aria-hidden className="h-4 w-4" /></EButton>
          <span className="w-2" aria-hidden />
          <div role="group" aria-label="View" className="flex flex-wrap gap-1.5">
            {CALENDAR_VIEWS.map((option) => (
              <Toggle key={option} pressed={view === option} onClick={() => props.onView(option)}>{VIEW_LABEL[option]}</Toggle>
            ))}
          </div>
          <EButton variant="ghost" size="sm" onClick={props.onRefresh} aria-label="Refresh calendar">
            <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", props.loading && "animate-spin")} />
          </EButton>
        </div>}
      </header>

      {props.weekStrip}

      <div className="flex flex-wrap items-center gap-1.5">
        {phone ? (
          <div role="group" aria-label="View" className="flex gap-1.5">
            {CALENDAR_VIEWS.map((option) => (
              <Toggle key={option} pressed={view === option} onClick={() => props.onView(option)}>{VIEW_LABEL[option]}</Toggle>
            ))}
          </div>
        ) : null}
        <EFilterBar label="Filter the calendar" className="contents" active={activeFilters} onClear={clearFilters} resultLabel="Show the calendar">
          <div role="group" aria-label="Rows" className="flex flex-wrap gap-1.5">
            <Toggle pressed={state.rows === "cleaners"} onClick={() => update({ rows: "cleaners" })}>Rows: cleaners</Toggle>
            <Toggle pressed={state.rows === "properties"} onClick={() => update({ rows: "properties" })}>Rows: properties</Toggle>
          </div>
          <span className="w-2" aria-hidden />
          <EFilterPopover label="Client" value={clientName}>
            {props.clientsState === "error" ? <p role="alert" className="text-[0.8125rem]">Clients could not be loaded.</p> : null}
            <label className="block text-[0.75rem] font-[600]">
              Client
              <select
                className="mt-1 h-9 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[0.8125rem]"
                value={state.clientId ?? ""}
                disabled={props.clientsState === "loading"}
                onChange={(event) => update({ clientId: event.target.value || null })}
              >
                <option value="">{props.clientsState === "loading" ? "Loading clients…" : "All clients"}</option>
                {props.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
          </EFilterPopover>
          <EFilterPopover label="Status" value={statusValue}>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-[0.75rem] font-[600]">Status</legend>
              {(Object.keys(CALENDAR_STATUS_GROUPS) as CalendarStatusFilter[]).map((group) => (
                <RadioOption key={group} name="calendar-status" checked={state.status === group} onChange={() => update({ status: group })}>
                  {withCount(statusFilterLabel(group), countFor(group, props.statusCounts))}
                </RadioOption>
              ))}
              <details className="pt-1">
                <summary className="cursor-pointer text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">One status</summary>
                <div className="mt-1.5 space-y-1.5">
                  {Object.keys(STATUS_LABELS).map((status) => (
                    <RadioOption key={status} name="calendar-status" checked={state.status === status} onChange={() => update({ status })}>
                      {withCount(STATUS_LABELS[status], countFor(status, props.statusCounts))}
                    </RadioOption>
                  ))}
                </div>
              </details>
            </fieldset>
            <label className="flex items-center gap-2 border-t border-[hsl(var(--e-border))] pt-2 text-[0.8125rem]">
              <input type="checkbox" checked={state.unassigned} onChange={(event) => update({ unassigned: event.target.checked })} className="accent-[hsl(var(--e-primary))]" />
              {withCount("Only jobs without a cleaner", props.unassignedTotal)}
            </label>
          </EFilterPopover>
          <Toggle pressed={state.laundry} onClick={() => update({ laundry: !state.laundry })}>Show laundry runs</Toggle>
          <Toggle pressed={state.arrivals} onClick={() => update({ arrivals: !state.arrivals })}>Show guest arrivals</Toggle>
        </EFilterBar>
        <span className="min-w-0 flex-1 max-sm:hidden" aria-hidden />
        {props.dragHint ? (
          <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {view === "day"
              ? "Drag a job to another cleaner, or along the hours to change its time (on touch, press and hold first). Clashes, leave and roster gaps are flagged before you confirm."
              : "Drag a job to another day or cleaner (on touch, press and hold first). Clashes, leave and roster gaps are flagged before you confirm."}
          </span>
        ) : (
          <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] max-sm:hidden">Use a job&rsquo;s menu to move or reassign it.</span>
        )}
      </div>

      {phone ? (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{props.summary}</p>
          <div className="flex shrink-0 items-center gap-1">
            <EButton variant="outline" size="icon" aria-label={`Previous ${STEP_LABEL[view]}`} onClick={() => props.onStep(-1)}><ChevronLeft aria-hidden className="h-4 w-4" /></EButton>
            <EButton variant="outline" size="icon" aria-label={`Next ${STEP_LABEL[view]}`} onClick={() => props.onStep(1)}><ChevronRight aria-hidden className="h-4 w-4" /></EButton>
            <EButton variant="ghost" size="icon" onClick={props.onRefresh} aria-label="Refresh calendar">
              <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", props.loading && "animate-spin")} />
            </EButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
