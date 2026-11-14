"use client";

/**
 * The admin Maintenance page as drawn (board "Maintenance", 2026-11-14): one
 * page under Operations with two tabs, Items and People and trades.
 *
 * Items: header with a real summary, Export CSV and Report an item; six tiles
 * that filter; the status bar; filters (Property, Priority, Category,
 * Reported by, Assigned to, Client price, Client sees it); one table with
 * server paging and sorting where rows that need someone carry a tint behind
 * the first cell and the reason beside the title; a row menu holding every
 * action; a bulk bar; and the item side panel on `?open=`.
 *
 * Phones (below 640px): three compact tiles, the status bar as chips, filters
 * behind "Filter", cards with title bands and at most one button, Select mode
 * with the bulk bar docked, and "+ Report" docked at the bottom.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { toneRowCellClass } from "@/components/v2/ui/tone-band";
import type { MaintenanceListRow, MaintenanceListSort } from "@/lib/maintenance/admin-list-types";
import { maintenanceColumns } from "./maintenance-columns";
import { MaintenanceFilters, type FilterPropertyOption } from "./maintenance-filters";
import { MaintenanceStatusBar, MaintenanceTilesRow } from "./maintenance-overview";
import { MaintenancePhoneList } from "./maintenance-phone-list";
import { MaintenancePanel } from "./maintenance-panel";
import { PeopleTradesTab } from "./people-trades-tab";
import { ReportItemDialog } from "./report-item-dialog";
import type { WorkerOption } from "./assign-sheet";
import type { MaintenanceActionTarget } from "./maintenance-types";
import { useMaintenanceActions } from "./use-maintenance-actions";
import { useMaintenanceList } from "./use-maintenance-list";
import { useMaintenanceView } from "./use-maintenance-view";
import { activeFilterCount, exportQueryString, viewSearch, type MaintenanceTab, type MaintenanceView } from "./maintenance-view";
import { dayTime } from "./maintenance-format";

function targetFromRow(row: MaintenanceListRow): MaintenanceActionTarget {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    clientVisible: row.clientVisible,
    propertyId: row.property.id,
    propertyName: row.property.name,
    jobId: row.job?.id ?? null,
    assignedWorkerId: row.assignedWorker?.id ?? null,
    quotedCost: row.quotedCost,
    costApprovalStatus: row.costApprovalStatus,
  };
}

/** Loads the maintenance workers (filters, People and trades). */
function useWorkerList(): { workers: WorkerOption[] | null; error: string | null; reload: () => void } {
  const [workers, setWorkers] = React.useState<WorkerOption[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch("/api/admin/maintenance/workers", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { workers?: WorkerOption[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.workers)) throw new Error(body?.error ?? "The workers could not be loaded.");
        setWorkers(body.workers);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The workers could not be loaded.");
      });
    return () => controller.abort();
  }, [revision]);
  return { workers, error, reload: React.useCallback(() => setRevision((value) => value + 1), []) };
}

const SORT_OPTIONS: Array<{ key: MaintenanceListSort; label: string; dir: "asc" | "desc" }> = [
  { key: "priority", label: "Priority ↓", dir: "desc" },
  { key: "reported", label: "Newest first", dir: "desc" },
  { key: "visit", label: "Visit, soonest", dir: "asc" },
  { key: "cost", label: "Cost, highest", dir: "desc" },
  { key: "title", label: "Item A–Z", dir: "asc" },
];

export function MaintenanceHub({
  initialView,
  properties,
  isAdmin,
  timeZone,
}: {
  initialView: MaintenanceView;
  properties: FilterPropertyOption[];
  isAdmin: boolean;
  timeZone: string;
}) {
  const [view, update] = useMaintenanceView(initialView);
  const list = useMaintenanceList(view);
  const workerList = useWorkerList();
  const phone = useIsPhone();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [phoneSelecting, setPhoneSelecting] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [panelRevision, setPanelRevision] = React.useState(0);
  const [panelNote, setPanelNote] = React.useState<{ id: string; note: string }>({ id: "", note: "" });

  const actions = useMaintenanceActions({
    timeZone,
    isAdmin,
    onChanged: () => {
      list.reload();
      setPanelRevision((value) => value + 1);
      workerList.reload();
    },
    onRefused: (ids) => setSelected(new Set(ids)),
  });

  // A different list: the old selection no longer describes what is on screen.
  const filterKey = list.query;
  React.useEffect(() => setSelected(new Set()), [filterKey]);
  // Opening another item drops the previous item's unsaved note.
  React.useEffect(() => {
    if (view.open && view.open !== panelNote.id) setPanelNote({ id: view.open, note: "" });
  }, [view.open, panelNote.id]);

  const data = list.data;
  const current = list.dataQuery === list.query;
  // Never show rows from another filter set as if they answered this one.
  const rows = current ? data?.rows ?? [] : [];
  const zone = data?.timeZone ?? timeZone;
  const tiles = data?.tiles ?? null;
  const staleError = list.error && current && list.loadedAt
    ? `${list.error} Showing the list from ${dayTime(new Date(list.loadedAt).toISOString(), zone)?.slice(-5) ?? "earlier"}.`
    : list.error;
  const open = React.useCallback((row: MaintenanceListRow) => update({ open: row.id }), [update]);
  const menuFor = React.useCallback((row: MaintenanceListRow) => actions.menuItems(targetFromRow(row), { openPage: true }), [actions]);
  const columns = React.useMemo(() => maintenanceColumns({ timeZone: zone, onOpen: open, menuFor }), [zone, open, menuFor]);
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const selectedTargets = selectedRows.map(targetFromRow);
  const bulkBlocked = Boolean(list.error) || list.loading || actions.running;
  const backHref = `/v2/admin/maintenance${viewSearch({ ...view, open: null })}`;

  function setTab(tab: MaintenanceTab) {
    update({ tab, open: null });
  }

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const summary = tiles
    ? `${tiles.open} open · ${tiles.urgent} urgent · ${tiles.waitingClient} waiting on a client price.`
    : list.error ? "The summary could not be loaded." : "Loading the summary…";
  const filtersActive = activeFilterCount(view) > 0 || view.status !== "open";

  const phoneTools = phone ? (
    <>
      <label className="sm:hidden">
        <span className="sr-only">Sort by</span>
        <select
          value={`${view.sort}:${view.dir}`}
          onChange={(event) => {
            const [sort, dir] = event.target.value.split(":") as [MaintenanceListSort, "asc" | "desc"];
            update({ sort, dir });
          }}
          className="h-11 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-base"
        >
          {SORT_OPTIONS.map((option) => <option key={option.key} value={`${option.key}:${option.dir}`}>{option.label}</option>)}
          {!SORT_OPTIONS.some((option) => option.key === view.sort && option.dir === view.dir) ? <option value={`${view.sort}:${view.dir}`}>Current order</option> : null}
        </select>
      </label>
      <EButton
        size="sm"
        variant={phoneSelecting ? "primary" : "outline"}
        aria-pressed={phoneSelecting}
        className="sm:hidden"
        onClick={() => {
          if (phoneSelecting) setSelected(new Set());
          setPhoneSelecting((value) => !value);
        }}
      >
        {phoneSelecting ? "Cancel" : "Select"}
      </EButton>
    </>
  ) : null;

  return (
    <div className="flex min-w-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3 sm:flex-nowrap">
          <div className="min-w-0 flex-1">
            <p className="e-eyebrow mb-1">Operations</p>
            <h1 className="e-display-md">Maintenance</h1>
            <p className="mt-1 max-w-3xl text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              <span className="max-sm:hidden">Things to repair or replace at Airbnb properties, reported by cleaners, QA inspectors, clients and the office. </span>
              {summary}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <EButton asChild variant="outline" size="sm">
              <a href={`/api/admin/maintenance/export?${exportQueryString(view)}`} download>Export CSV</a>
            </EButton>
            <EButton size="sm" className="max-sm:hidden" onClick={() => setReportOpen(true)}>+ Report an item</EButton>
          </div>
        </header>

        <div role="tablist" aria-label="Maintenance sections" className="flex gap-1 border-b border-[hsl(var(--e-border))]">
          {([
            { key: "items", label: "Items", count: tiles?.open ?? null },
            { key: "people", label: "People and trades", count: workerList.workers ? workerList.workers.filter((worker) => worker.isActive).length : null },
          ] as Array<{ key: MaintenanceTab; label: string; count: number | null }>).map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`maintenance-tab-${tab.key}`}
              aria-selected={view.tab === tab.key}
              aria-controls={`maintenance-panel-${tab.key}`}
              onClick={() => setTab(tab.key)}
              className={cn(
                "-mb-px min-h-11 whitespace-nowrap border-b-2 px-3 text-[0.8125rem] sm:min-h-9",
                view.tab === tab.key ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-foreground))]" : "border-transparent text-[hsl(var(--e-muted-foreground))]",
              )}
            >
              {tab.label}{tab.count !== null ? <span className="e-tnum"> {tab.count}</span> : null}
            </button>
          ))}
        </div>

        {view.tab === "people" ? (
          <div role="tabpanel" id="maintenance-panel-people" aria-labelledby="maintenance-tab-people">
            <PeopleTradesTab workers={workerList.workers} error={workerList.error} isAdmin={isAdmin} timeZone={zone} onReload={workerList.reload} />
          </div>
        ) : (
          <div role="tabpanel" id="maintenance-panel-items" aria-labelledby="maintenance-tab-items" className="flex min-w-0 flex-col gap-3">
            <MaintenanceTilesRow tiles={tiles} view={view} onApply={update} compact={Boolean(view.open)} />
            <MaintenanceStatusBar counts={current ? data?.statusCounts ?? null : null} active={view.status} onChange={(status) => update({ status })} />
            <MaintenanceFilters
              view={view}
              onChange={update}
              properties={properties}
              workers={workerList.workers ? workerList.workers.filter((worker) => worker.isActive).map((worker) => ({ id: worker.id, name: worker.name })) : null}
              total={current ? data?.total ?? null : null}
              tools={phoneTools}
            />

            <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] max-sm:hidden">
              <EDataTable<MaintenanceListRow, MaintenanceListSort>
                label="Maintenance items"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                sort={{ key: view.sort, dir: view.dir }}
                onSortChange={(next) => update({ sort: next.key, dir: next.dir })}
                selection={{ selected, onChange: setSelected, rowLabel: (row) => `Select ${row.title}`, disabled: actions.running }}
                loading={list.loading}
                error={staleError}
                onRetry={list.reload}
                emptyTitle={filtersActive ? "Nothing matches" : "No open items"}
                emptyDescription={filtersActive ? "No items match these filters. Clear the filters to see every open item." : "Nothing to repair or replace at the moment."}
                onRowClick={open}
                activeRowKey={view.open}
                leadCellClassName={(row) => (row.attention ? toneRowCellClass(row.attention.tone) : undefined)}
                minWidth="60rem"
                cellPadding="px-2.5 py-2"
              />
            </div>

            {phone ? (
              <div className="sm:hidden">
                {rows.length > 0 ? (
                  <>
                    {staleError ? (
                      <div role="alert" className="mb-2 flex items-center justify-between gap-2 rounded-[10px] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">
                        <span>{staleError}</span>
                        <EButton size="sm" variant="outline" onClick={list.reload}>Try again</EButton>
                      </div>
                    ) : null}
                    {phoneSelecting ? (
                      <div className="mb-2 flex items-center justify-between gap-2 text-[0.8125rem]">
                        <b aria-live="polite">{selected.size} selected</b>
                        <EButton size="sm" variant="ghost" onClick={() => setSelected(new Set(rows.map((row) => row.id)))}>Select all {rows.length}</EButton>
                      </div>
                    ) : null}
                    <MaintenancePhoneList
                      rows={rows}
                      timeZone={zone}
                      selecting={phoneSelecting}
                      selected={selected}
                      onToggle={toggle}
                      onOpen={open}
                      onAssign={(row) => actions.openAssign([targetFromRow(row)])}
                      menuFor={menuFor}
                    />
                  </>
                ) : list.loading ? (
                  <ul aria-label="Loading items" className="flex flex-col gap-2.5" role="status">
                    {[0, 1, 2].map((index) => <li key={index} className="h-24 animate-pulse rounded-[12px] bg-[hsl(var(--e-surface-raised))]" />)}
                    <span className="sr-only">Loading…</span>
                  </ul>
                ) : list.error ? (
                  <div role="alert" className="space-y-2 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-[0.875rem]">
                    <p>The list could not be loaded. Filters kept.</p>
                    <p className="text-[hsl(var(--e-muted-foreground))]">{list.error}</p>
                    <EButton size="sm" variant="outline" onClick={list.reload}>Try again</EButton>
                  </div>
                ) : (
                  <div className="rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-[0.875rem]">
                    <p className="font-semibold">{filtersActive ? "Nothing matches" : "No open items"}</p>
                    {filtersActive ? <EButton size="sm" variant="ghost" onClick={() => update({ status: "open", q: "", propertyId: "", priority: [], category: "", source: [], assigned: "any", price: "any", visible: "any", period: "any" })}>Clear filters</EButton> : null}
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              {data && current ? <EPagination className="min-w-0 flex-1" page={data.page} pageSize={data.pageSize} total={data.total} noun="items" disabled={list.loading} onPageChange={(page) => update({ page })} /> : <span />}
              <EButton size="sm" variant="ghost" disabled={list.loading} onClick={list.reload}>Refresh</EButton>
            </div>

            <EBulkBar
              count={selectedRows.length}
              noun={{ one: "item", many: "items" }}
              onClear={() => setSelected(new Set())}
              busy={bulkBlocked}
              phoneActions={6}
              note={list.error ? "Bulk actions wait until the list is current." : undefined}
            >
              <EBulkButton key="ack" onClick={() => actions.requestStatus(selectedTargets, "ACKNOWLEDGED")}>Acknowledge</EBulkButton>
              <EBulkButton key="progress" onClick={() => actions.requestStatus(selectedTargets, "IN_PROGRESS")}>{phone ? "In progress" : "Mark in progress"}</EBulkButton>
              <EBulkButton key="ordered" onClick={() => actions.requestStatus(selectedTargets, "ORDERED")}>{phone ? "Ordered" : "Mark ordered"}</EBulkButton>
              <EBulkButton key="resolve" onClick={() => actions.requestStatus(selectedTargets, "RESOLVED")}>{phone ? "Resolve…" : "Mark resolved…"}</EBulkButton>
              <EBulkButton key="dismiss" onClick={() => actions.requestStatus(selectedTargets, "DISMISSED")}>Dismiss…</EBulkButton>
              <EBulkButton key="assign" onClick={() => actions.openAssign(selectedTargets)}>Assign…</EBulkButton>
            </EBulkBar>
          </div>
        )}
      </div>

      {view.tab === "items" && view.open ? (
        <MaintenancePanel
          key={view.open}
          itemId={view.open}
          revision={panelRevision}
          timeZone={zone}
          backHref={backHref}
          note={panelNote.id === view.open ? panelNote.note : ""}
          onNoteChange={(note) => setPanelNote({ id: view.open ?? "", note })}
          actions={actions}
          onClose={() => update({ open: null })}
        />
      ) : null}

      <EPhoneActionBar
        label="Maintenance actions"
        hidden={selected.size > 0 || phoneSelecting || Boolean(view.open) || view.tab !== "items"}
        primary={<EButton onClick={() => setReportOpen(true)}>+ Report</EButton>}
      />

      <ReportItemDialog
        open={reportOpen}
        properties={properties}
        onClose={() => setReportOpen(false)}
        onCreated={(itemId) => {
          setReportOpen(false);
          update({ open: itemId });
          list.reload();
        }}
      />
      {actions.dialogs}
    </div>
  );
}
