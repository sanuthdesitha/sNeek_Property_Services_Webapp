"use client";

/**
 * The Properties page as drawn: heading with the real summary, Export and Add
 * property; four stat cards; the filter row; the table (or Cards / Map) with
 * server paging and sorting; the bulk bar; the preview panel on `?open=`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EPill } from "@/components/v2/ui/pill";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { CollapsibleFigures } from "@/components/v2/ui/collapsible-figures";
import type { PortfolioListResponse, PortfolioRow, PortfolioSort } from "@/lib/properties/portfolio-options";
import type { PropertyBulkResult } from "@/lib/properties/bulk-types";
import { portfolioColumns } from "./portfolio-columns";
import { PortfolioFilters } from "./portfolio-filters";
import { PortfolioBulk } from "./portfolio-bulk";
import { PortfolioCards, PortfolioMap } from "./portfolio-cards";
import { PropertyPreviewPanel } from "./property-preview-panel";
import { portfolioFilterParams, portfolioListQuery, type PortfolioView } from "./portfolio-view";
import { PORTFOLIO_PAGE_SIZE, usePortfolioList, usePortfolioView } from "./use-portfolio";

function summaryLine(data: PortfolioListResponse | null): string {
  if (!data) return "Loading…";
  const { active, clients, needsAttention } = data.stats;
  return `${active} active ${active === 1 ? "property" : "properties"} for ${clients} ${clients === 1 ? "client" : "clients"} · ${needsAttention} need attention`;
}

function StatCard({ label, value, aside }: { label: string; value: number | null; aside?: React.ReactNode }) {
  return (
    <ECard className="min-w-0 flex-1 p-4">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="e-numeral text-[1.75rem] leading-none">{value === null ? "–" : value.toLocaleString("en-AU")}</span>
        {aside}
      </div>
    </ECard>
  );
}

function StatCards({ data }: { data: PortfolioListResponse | null }) {
  const stats = data?.stats ?? null;
  return (
    <section aria-label="Portfolio figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Active" value={stats?.active ?? null} aside={stats ? <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{stats.clients} clients</span> : null} />
      <StatCard label="Calendar linked" value={stats?.calendarLinked ?? null} aside={stats && stats.syncErrors > 0 ? <EPill tone="bad">{stats.syncErrors} sync {stats.syncErrors === 1 ? "error" : "errors"}</EPill> : null} />
      <StatCard label="Cleans next 7 days" value={stats?.cleansNext7Days ?? null} aside={stats && stats.unassignedNext7Days > 0 ? <EPill tone="warn">{stats.unassignedNext7Days} unassigned</EPill> : null} />
      <StatCard label="Jobs, all time" value={stats?.jobsAllTime ?? null} />
    </section>
  );
}

export function PortfolioHub({ initialView, timeZone }: { initialView: PortfolioView; timeZone: string }) {
  const [view, update] = usePortfolioView(initialView);
  const list = usePortfolioList(view);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const listKey = portfolioListQuery(view, PORTFOLIO_PAGE_SIZE);
  // A different list: the old selection no longer describes what is on screen.
  useEffect(() => setSelected(new Set()), [listKey]);

  const data = list.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = useCallback((row: PortfolioRow) => update({ open: row.id }), [update]);
  const archived = useCallback(() => {
    update({ open: null });
    list.reload();
  }, [update, list]);
  const columns = useMemo(() => portfolioColumns({ now, onOpen: open, onArchived: archived }), [now, open, archived]);
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const exportBase = `/api/admin/properties/export?${portfolioFilterParams(view).toString()}`;

  function bulkFinished(results: PropertyBulkResult[]) {
    setSelected(new Set(results.filter((result) => result.outcome === "refused" || result.outcome === "failed").map((result) => result.id)));
    list.reload();
  }

  return (
    <div className="flex min-w-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="e-display-md">Properties</h1>
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{summaryLine(data)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EButton asChild variant="outline" size="sm">
              <a href={exportBase} download>Export</a>
            </EButton>
            <EButton asChild size="sm" className="max-sm:hidden">
              <Link href="/v2/admin/properties/new">Add property</Link>
            </EButton>
          </div>
        </header>

        {/* Phones (board M-Properties): the four figures fold behind one row. */}
        <CollapsibleFigures storageKey="properties:portfolio" count={4} label="Portfolio figures">
          <StatCards data={data} />
        </CollapsibleFigures>
        <PortfolioFilters view={view} data={data} onChange={update} disabled={bulkRunning} />

        {view.mode === "list" ? (
          <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
            <EDataTable<PortfolioRow, PortfolioSort>
              label="Properties"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              sort={{ key: view.sort, dir: view.dir }}
              onSortChange={(next) => update({ sort: next.key, dir: next.dir })}
              selection={{ selected, onChange: setSelected, rowLabel: (row) => `Select ${row.name}`, disabled: bulkRunning }}
              loading={list.loading}
              error={list.error}
              onRetry={list.reload}
              emptyTitle="No properties match"
              emptyDescription="Try another filter, or clear the search."
              onRowClick={open}
              activeRowKey={view.open}
              minWidth="58rem"
            />
          </div>
        ) : null}
        {view.mode === "cards" ? (
          list.error && !data ? (
            <ECard role="alert" className="p-6 text-[0.875rem]">{list.error} <EButton size="sm" variant="outline" onClick={list.reload}>Try again</EButton></ECard>
          ) : data ? (
            <PortfolioCards rows={rows} now={now} activeId={view.open} onOpen={open} />
          ) : (
            <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
          )
        ) : null}
        {view.mode === "map" ? <PortfolioMap mapped={data?.mapped ?? 0} total={data?.total ?? 0} /> : null}

        {view.mode !== "map" && data ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <EPagination className="min-w-0 flex-1" page={data.page} pageSize={data.pageSize} total={data.total} noun="properties" disabled={list.loading} onPageChange={(page) => update({ page })} />
          </div>
        ) : null}
        {view.mode === "list" ? (
          <PortfolioBulk
            selectedRows={selectedRows}
            exportHref={`${exportBase}&ids=${encodeURIComponent(selectedRows.map((row) => row.id).join(","))}`}
            onClear={() => setSelected(new Set())}
            onFinished={bulkFinished}
            onRunningChange={setBulkRunning}
          />
        ) : null}
        <EPhoneActionBar
          label="Properties actions"
          hidden={selected.size > 0}
          primary={
            <EButton asChild>
              <Link href="/v2/admin/properties/new">Add property</Link>
            </EButton>
          }
        />
      </div>

      {view.open ? (
        <PropertyPreviewPanel key={view.open} propertyId={view.open} timeZone={timeZone} onClose={() => update({ open: null })} onArchived={archived} />
      ) : null}
    </div>
  );
}
