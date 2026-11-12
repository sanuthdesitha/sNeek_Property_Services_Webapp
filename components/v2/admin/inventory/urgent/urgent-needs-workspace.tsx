"use client";

/**
 * Stock → Urgent needs, as drawn: the page header ("Stock", a real summary,
 * Reminder settings, Report a need), the inventory tabs, stage chips with real
 * counts, search and Property, one all-property table sorted by Needed by,
 * the bulk bar and the need panel on `?open=`. Administrators, and since Wave F
 * operations managers with the inventory pack (the service checks both);
 * resolving and reminder settings stay with administrators. A need never
 * places a purchase or proves a delivery.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { UrgentNeedListRow, UrgentListSummary } from "@/lib/inventory/urgent-stock-list";
import { URGENT_FILTERS, URGENT_FILTER_LABEL, type UrgentSort } from "@/lib/inventory/urgent-stock-actions";
import { urgentColumns } from "./urgent-columns";
import { UrgentBulk } from "./urgent-bulk";
import { NeedPanel } from "./need-panel";
import { PropertyStayPreparation } from "./property-stay-preparation";
import { NeedActionDialog } from "./need-action-dialog";
import { ReportNeedDialog } from "./report-need-dialog";
import { ReminderSettingsDialog } from "./reminder-settings-dialog";
import { urgentListQuery, type UrgentView } from "./urgent-view";
import { URGENT_PAGE_SIZE, useUrgentNeeds, useUrgentView } from "./use-urgent-needs";
import { AddToRunDialog } from "./add-to-run-dialog";

function summaryLine(summary: UrgentListSummary | undefined): string {
  if (!summary) return "Loading…";
  const needs = `${summary.open} urgent ${summary.open === 1 ? "need" : "needs"} across ${summary.properties} ${summary.properties === 1 ? "property" : "properties"}`;
  // As drawn ("2 must arrive before the next clean"), with the real window stated.
  return `${needs} · ${summary.dueSoon} must arrive before the next clean (within 48 hours)`;
}

export function UrgentNeedsWorkspace({ initialView, tabs, timeZone, isAdmin }: { initialView: UrgentView; tabs: React.ReactNode; timeZone: string; isAdmin: boolean }) {
  const [view, update] = useUrgentView(initialView);
  const list = useUrgentNeeds(view);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = React.useState(false);
  const [acting, setActing] = React.useState<UrgentNeedListRow | null>(null);
  const [addingToRun, setAddingToRun] = React.useState<UrgentNeedListRow | null>(null);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [stayOpen, setStayOpen] = React.useState(false);

  const listKey = urgentListQuery(view, URGENT_PAGE_SIZE);
  React.useEffect(() => setSelected(new Set()), [listKey]);
  // A different property: the stay-preparation tool belongs to the old one.
  React.useEffect(() => setStayOpen(false), [view.propertyId]);

  const data = list.data;
  const rows = data?.rows ?? [];
  const zone = data?.timeZone ?? timeZone;
  const open = React.useCallback((row: UrgentNeedListRow) => update({ open: row.id }), [update]);
  const columns = React.useMemo(() => urgentColumns(zone, { open, act: setActing, addToRun: setAddingToRun }), [zone, open]);
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const property = data?.propertyOptions.find((option) => option.id === view.propertyId);
  const openRow = view.open ? rows.find((row) => row.id === view.open) ?? null : null;

  return (
    <div className="flex min-w-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="e-display-md">Stock</h1>
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{summaryLine(data?.summary)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin ? <EButton size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>Reminder settings</EButton> : null}
            <EButton size="sm" onClick={() => setReportOpen(true)}>Report a need</EButton>
          </div>
        </header>

        {tabs}

        <div className="flex flex-wrap items-center gap-2">
          <EFilterChips
            label="Need stages"
            chips={URGENT_FILTERS.filter((filter) => filter !== "all").map((filter) => ({ key: filter, label: URGENT_FILTER_LABEL[filter], count: filter === "closed" ? null : data?.counts[filter] ?? null }))}
            active={view.filter === "all" ? "open" : view.filter}
            onChange={(filter) => update({ filter })}
          />
          <span className="min-w-0 flex-1" />
          <EInput type="search" aria-label="Search" placeholder="Search item or property" value={view.q} onChange={(event) => update({ q: event.target.value })} className="h-8 w-full sm:w-[200px]" />
          <EFilterPopover label="Property" value={property?.name ?? (view.propertyId ? "Selected" : null)}>
            <EField label="Property">
              <ESelect value={view.propertyId} onChange={(event) => update({ propertyId: event.target.value })}>
                <option value="">All properties</option>
                {(data?.propertyOptions ?? []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </ESelect>
            </EField>
          </EFilterPopover>
        </div>

        <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          <EDataTable<UrgentNeedListRow, UrgentSort>
            label="Urgent needs"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            sort={{ key: view.sort, dir: view.dir }}
            onSortChange={(next) => update({ sort: next.key, dir: next.dir })}
            selection={{ selected, onChange: setSelected, rowLabel: (row) => `Select ${row.itemName} at ${row.propertyName}`, disabled: bulkRunning }}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            emptyTitle={view.filter === "open" ? "No open urgent needs" : "No needs match"}
            emptyDescription="Cleaners report needs from their job; the office can report one with Report a need."
            onRowClick={open}
            activeRowKey={view.open}
            minWidth="58rem"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {data ? <EPagination className="min-w-0 flex-1" page={data.page} pageSize={data.pageSize} total={data.total} noun="needs" disabled={list.loading} onPageChange={(page) => update({ page })} /> : <span />}
          <EButton size="sm" variant="ghost" disabled={list.loading} onClick={list.reload}>Refresh</EButton>
        </div>
        <UrgentBulk
          selectedRows={selectedRows}
          canResolve={isAdmin}
          onClear={() => setSelected(new Set())}
          onRunningChange={setBulkRunning}
          onFinished={(results) => {
            setSelected(new Set(results.filter((result) => result.outcome === "refused").map((result) => result.id)));
            list.reload();
          }}
        />
        {view.propertyId ? (
          <section aria-label="Stay preparation for the selected property" className="rounded-[12px] border border-[hsl(var(--e-border))] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[0.9375rem] font-[600]">Stay preparation · {property?.name ?? "selected property"}</h2>
              <EButton size="sm" variant="outline" aria-expanded={stayOpen} onClick={() => setStayOpen((value) => !value)}>{stayOpen ? "Hide" : "Show"}</EButton>
            </div>
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Planning estimates and the per-stay quantities for this property. It does not reserve, deduct or order stock.</p>
            {stayOpen ? <div className="mt-3"><PropertyStayPreparation key={view.propertyId} propertyId={view.propertyId} /></div> : null}
          </section>
        ) : null}
      </div>

      {view.open ? <NeedPanel key={view.open} needId={view.open} row={openRow} timeZone={zone} canResolve={isAdmin} onClose={() => update({ open: null })} onChanged={list.reload} /> : null}
      {acting ? (
        <NeedActionDialog
          need={acting}
          mode="next"
          onClose={() => setActing(null)}
          onDone={() => {
            setActing(null);
            list.reload();
          }}
        />
      ) : null}
      {addingToRun ? <AddToRunDialog needs={[addingToRun]} onClose={() => setAddingToRun(null)} onDone={() => list.reload()} /> : null}
      <ReportNeedDialog key={view.propertyId} open={reportOpen} initialPropertyId={view.propertyId} onClose={() => setReportOpen(false)} onReported={() => { setReportOpen(false); list.reload(); }} />
      <ReminderSettingsDialog open={isAdmin && settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
