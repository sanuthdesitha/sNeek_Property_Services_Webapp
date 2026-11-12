"use client";

/**
 * People › Clients as drawn: search, Everyone / Needs attention view chips,
 * the client chips with real counts, Clear, Columns; header figures (Total
 * clients, Outstanding receivables with overdue, Paid this month, Active
 * properties); the server-paged, server-sorted table; the bulk bar; the side
 * panel. Read from GET /api/admin/clients/directory.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EPill } from "@/components/v2/ui/pill";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { formatMoney } from "@/components/v2/admin/accounts/hub/account-display";
import type { ClientBulkResponse } from "@/lib/people/clients/bulk-types";
import { CLIENT_DIRECTORY_FILTER_LABEL, type ClientDirectoryFilter, type ClientDirectoryResponse, type ClientDirectoryRow } from "@/lib/people/clients/types";
import type { PeopleCounts } from "@/lib/people/counts";
import type { PeopleTab } from "@/lib/people/tabs";
import { FactStrip } from "../fact-strip";
import { useRead } from "../use-read";
import { ClientPanel } from "./client-panel";
import { ClientsBulk } from "./clients-bulk";
import { ClientColumnsMenu, clientColumns, DEFAULT_CLIENT_COLUMNS, type ClientColumnPrefs } from "./clients-columns";
import { clientsListQuery, clientsViewSearch, patchClientsView, readClientsView, type ClientsView } from "./clients-view";

const CHIPS: ClientDirectoryFilter[] = ["active", "inactive", "owing", "overdue", "no-login", "assistants"];
const COLUMNS_KEY = "sneek:people:clients:columns:v1";
const SEARCH_DELAY_MS = 300;

function isDirectory(body: unknown): body is ClientDirectoryResponse {
  return Boolean(body && typeof body === "object" && Array.isArray((body as { rows?: unknown }).rows) && "figures" in body);
}

function readPrefs(): ClientColumnPrefs {
  try {
    const raw = window.localStorage.getItem(COLUMNS_KEY);
    return raw ? { ...DEFAULT_CLIENT_COLUMNS, ...(JSON.parse(raw) as Partial<ClientColumnPrefs>) } : DEFAULT_CLIENT_COLUMNS;
  } catch {
    return DEFAULT_CLIENT_COLUMNS;
  }
}

function money(value: number | null | undefined): string | null {
  return typeof value === "number" ? formatMoney(value) : null;
}

export function ClientsTab({
  initialSearch,
  counts,
  onExportHref,
  onSelectView,
}: {
  initialSearch: string;
  counts: PeopleCounts;
  onExportHref: (href: string | null) => void;
  onSelectView: (tab: PeopleTab) => void;
}) {
  const [view, setView] = useState<ClientsView>(() => readClientsView(initialSearch));
  const [search, setSearch] = useState(view.q);
  const [columns, setColumns] = useState<ClientColumnPrefs>(DEFAULT_CLIENT_COLUMNS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const query = clientsListQuery(view);
  const list = useRead<ClientDirectoryResponse>(`/api/admin/clients/directory?${query}`, isDirectory, { failure: "Could not load clients." });

  const update = useCallback((patch: Partial<ClientsView>) => {
    setView((current) => {
      const next = patchClientsView(current, patch);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${clientsViewSearch(next)}`);
      return next;
    });
  }, []);

  useEffect(() => setColumns(readPrefs()), []);
  useEffect(() => setSelected(new Set()), [query]);
  useEffect(() => onExportHref(`/api/admin/clients/directory?format=csv&${query}`), [query, onExportHref]);
  useEffect(() => {
    if (search === view.q) return;
    const timer = window.setTimeout(() => update({ q: search }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, view.q, update]);

  function changeColumns(next: ClientColumnPrefs) {
    setColumns(next);
    try {
      window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      /* preference only */
    }
  }

  const data = list.data;
  const visibility = data?.columns ?? { money: false };
  const rows = data?.rows ?? [];
  const open = useCallback((row: ClientDirectoryRow) => update({ open: row.id }), [update]);
  const tableColumns = useMemo(() => clientColumns(visibility, columns, { onOpen: open }), [visibility, columns, open]);
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const figures = data?.figures;

  function bulkFinished(response: ClientBulkResponse) {
    setSelected(new Set(response.results.filter((result) => result.outcome === "refused").map((result) => result.id)));
    list.reload();
  }

  return (
    <div className="flex min-w-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search clients"
            placeholder="Search client, email, suburb, phone"
            className="h-8 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.8125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] sm:w-[240px]"
          />
          <button type="button" aria-pressed={false} onClick={() => onSelectView("everyone")} className={E_CHIP_CLASS}>
            Everyone{typeof counts.everyone === "number" ? <span className="e-tnum ml-1">{counts.everyone}</span> : null}
          </button>
          <button type="button" aria-pressed={view.filter === "attention"} onClick={() => update({ filter: view.filter === "attention" ? "active" : "attention" })} className={cn(E_CHIP_CLASS, view.filter === "attention" && E_CHIP_ON_CLASS)}>
            Needs attention{data ? <span className="e-tnum ml-1">{data.counts.attention}</span> : null}
          </button>
          <div role="group" aria-label="Client filters" className="flex flex-wrap items-center gap-1.5">
            {CHIPS.map((chip) => {
              const pressed = view.filter === chip;
              return (
                <button key={chip} type="button" aria-pressed={pressed} onClick={() => update({ filter: pressed ? "all" : chip })} className={cn(E_CHIP_CLASS, pressed && E_CHIP_ON_CLASS)}>
                  {CLIENT_DIRECTORY_FILTER_LABEL[chip]}
                  {data ? <span className="e-tnum ml-1">{data.counts[chip]}</span> : null}
                </button>
              );
            })}
          </div>
          <EButton size="sm" variant="ghost" onClick={() => { setSearch(""); update({ filter: "all", q: "" }); }}>Clear</EButton>
          <span className="hidden flex-1 sm:block" />
          <Link href="/v2/admin/accounts?tab=assistants" className="text-[0.8125rem] underline" onClick={(event) => { event.preventDefault(); onSelectView("assistants"); }}>Client assistants</Link>
          <ClientColumnsMenu visibility={visibility} prefs={columns} onChange={changeColumns} />
        </div>

        <FactStrip
          label="Client figures"
          collapsible={{ storageKey: "people:clients" }}
          facts={[
            { key: "total", label: "Total clients", value: figures ? figures.totalClients : counts.clients },
            ...(visibility.money
              ? [
                  {
                    key: "outstanding",
                    label: "Outstanding receivables",
                    value: money(figures?.outstanding),
                    extra: figures && (figures.overdue ?? 0) > 0 ? <EPill tone="bad">{formatMoney(figures.overdue ?? 0)} overdue</EPill> : undefined,
                  },
                  { key: "paid", label: "Paid this month", value: money(figures?.paidThisMonth) },
                ]
              : []),
            { key: "properties", label: "Active properties", value: figures ? figures.activeProperties : null },
          ]}
        />

        <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          <EDataTable<ClientDirectoryRow>
            label="Clients"
            columns={tableColumns}
            rows={rows}
            rowKey={(row) => row.id}
            sort={{ key: view.sort, dir: view.dir }}
            onSortChange={(next) => update({ sort: next.key as ClientsView["sort"], dir: next.dir })}
            selection={{ selected, onChange: setSelected, rowLabel: (row) => `Select ${row.name}`, disabled: bulkRunning }}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            emptyTitle="No clients match"
            emptyDescription="Try another chip, or clear the search."
            onRowClick={open}
            activeRowKey={view.open}
            minWidth="56rem"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {data ? <EPagination className="min-w-0 flex-1" page={data.page} pageSize={data.pageSize} total={data.total} noun="clients" disabled={list.loading} onPageChange={(page) => update({ page })} /> : <span />}
          <EButton size="sm" variant="ghost" disabled={list.loading} onClick={list.reload}>Refresh</EButton>
        </div>
        <ClientsBulk
          selectedRows={selectedRows}
          exportHref={`/api/admin/clients/directory?format=csv&${query}&ids=${selectedRows.map((row) => row.id).join(",")}`}
          onClear={() => setSelected(new Set())}
          onFinished={bulkFinished}
          onRunningChange={setBulkRunning}
        />
      </div>
      {view.open ? <ClientPanel clientId={view.open} onClose={() => update({ open: null })} /> : null}
    </div>
  );
}
