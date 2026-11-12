"use client";

/**
 * The Lost and found page as drawn: header with a real summary, Export and
 * Log an item; stage tabs with counts; filters; one table with server paging
 * and sorting; a bulk bar; the item panel on `?open=`.
 */
import { useCallback, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import type { LostFoundBulkResult } from "@/lib/lost-found/bulk-types";
import type { LostFoundListRow } from "@/lib/lost-found/list";
import { DEFAULT_HOLDING_DAYS } from "@/lib/lost-found/holding";
import { lostFoundColumns } from "./lost-found-columns";
import { LostFoundFilters, LostFoundTabs } from "./lost-found-filters";
import { LostFoundBulk } from "./lost-found-bulk";
import { ItemPanel } from "./item-panel";
import { LogItemDialog } from "./log-item-dialog";
import { exportQueryString, listQueryString, type LostFoundView } from "./lost-found-view";
import { useLostFoundView } from "./use-lost-found-view";
import { LOST_FOUND_PAGE_SIZE, useLostFoundList } from "./use-lost-found-list";

function summaryLine(summary: { open: number; pastHolding: number } | undefined, holdingDays: number): string {
  if (!summary) return "Loading…";
  return `${summary.open} open ${summary.open === 1 ? "item" : "items"} · ${summary.pastHolding} waiting more than ${holdingDays} days`;
}

export function LostFoundHub({ initialView, isAdmin, timeZone }: { initialView: LostFoundView; isAdmin: boolean; timeZone: string }) {
  const [view, update] = useLostFoundView(initialView);
  const list = useLostFoundList(view);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const listKey = listQueryString(view, LOST_FOUND_PAGE_SIZE);
  // A different list: the old selection no longer describes what is on screen.
  useEffect(() => setSelected(new Set()), [listKey]);

  const data = list.data;
  const rows = data?.rows ?? [];
  const holdingDays = data?.holdingDays ?? DEFAULT_HOLDING_DAYS;
  const zone = data?.timeZone ?? timeZone;
  const open = useCallback((row: LostFoundListRow) => update({ open: row.id }), [update]);
  const columns = useMemo(() => lostFoundColumns(zone, open), [zone, open]);
  const selectedRows = rows.filter((row) => selected.has(row.id));

  function bulkFinished(results: LostFoundBulkResult[]) {
    setSelected(new Set(results.filter((result) => result.outcome === "refused").map((result) => result.id)));
    list.reload();
  }

  return (
    <div className="flex min-w-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="e-display-md">Lost and found</h1>
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {summaryLine(data?.summary, holdingDays)}
              {isAdmin ? <> · <Link className="underline" href="/v2/admin/settings?tab=lost-found">Holding period</Link></> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EButton asChild variant="outline" size="sm">
              <a href={`/api/admin/lost-found/export?${exportQueryString(view)}`} download>Export</a>
            </EButton>
            <EButton size="sm" onClick={() => setLogOpen(true)}>Log an item</EButton>
          </div>
        </header>

        <LostFoundTabs active={view.tab} counts={data?.counts ?? null} onSelect={(tab) => update({ tab })} />
        <LostFoundFilters view={view} onChange={update} properties={data?.properties ?? []} holdingDays={data?.holdingDays ?? null} />

        <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          <EDataTable<LostFoundListRow, LostFoundView["sort"]>
            label="Lost and found items"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            sort={{ key: view.sort, dir: view.dir }}
            onSortChange={(next) => update({ sort: next.key, dir: next.dir })}
            selection={{ selected, onChange: setSelected, rowLabel: (row) => `Select ${row.itemName}`, disabled: bulkRunning }}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            emptyTitle="No items match"
            emptyDescription="Try another stage, or clear the search and filters."
            onRowClick={open}
            activeRowKey={view.open}
            minWidth="56rem"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {data ? <EPagination className="min-w-0 flex-1" page={data.page} pageSize={data.pageSize} total={data.total} noun="items" disabled={list.loading} onPageChange={(page) => update({ page })} /> : <span />}
          <EButton size="sm" variant="ghost" disabled={list.loading} onClick={list.reload}>Refresh</EButton>
        </div>
        <LostFoundBulk selectedRows={selectedRows} onClear={() => setSelected(new Set())} onFinished={bulkFinished} onRunningChange={setBulkRunning} />
      </div>

      {view.open ? (
        <ItemPanel key={view.open} itemId={view.open} timeZone={zone} holdingDays={holdingDays} onClose={() => update({ open: null })} onChanged={list.reload} />
      ) : null}

      <LogItemDialog
        open={logOpen}
        timeZone={zone}
        onClose={() => setLogOpen(false)}
        onCreated={(itemId) => {
          setLogOpen(false);
          update({ tab: "new", open: itemId });
          list.reload();
        }}
      />
    </div>
  );
}
