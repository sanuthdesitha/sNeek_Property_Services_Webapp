"use client";

/**
 * Suppliers (board "Suppliers"): everyone we buy from or hand work to, in one
 * directory at Inventory › Suppliers (`/v2/admin/inventory?tab=suppliers`,
 * URL kept). Laundry partners and stock suppliers are created and edited here
 * through their existing routes; trades are a read model over maintenance
 * workers and are edited in Maintenance. URL state: `type` (tab) and `open`
 * (the panel). Rows, counts and figures come from the directory endpoint.
 */
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard, EPageHeader } from "@/components/v2/ui/primitives";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EConfirmModal, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { LaundryPartnerRecord, StockSupplierRecord } from "@/lib/suppliers/directory-types";
import {
  DEFAULT_FILTERS,
  DIRECTORY_TABS,
  buildDirectoryEntries,
  categoryOptions,
  directoryCsv,
  filterDirectory,
  readDirectoryTab,
  tabCounts,
  type DirectoryEntry,
  type DirectoryFilters,
  type DirectorySort,
  type DirectoryTab,
} from "@/lib/suppliers/directory-view";
import { LaundryPartnerEditor, type PartnerEditorTarget } from "../laundry-partner-editor";
import { StockSupplierEditor, type StockEditorTarget } from "./stock-supplier-editor";
import { SupplierPanel } from "./supplier-panel";
import { MAINTENANCE_HREF } from "./supplier-panel-sections";
import { SupplierTable } from "./supplier-table";
import { useSupplierDirectory } from "./use-supplier-directory";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`min-h-9 rounded-full border px-3 text-[0.8125rem] ${on ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.1)] font-[550]" : "border-[hsl(var(--e-border-strong))]"}`}>
      {children}
    </button>
  );
}

function downloadCsv(entries: DirectoryEntry[]) {
  const blob = new Blob([directoryCsv(entries)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "suppliers.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function SuppliersDirectory({ tabs }: { tabs?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data, load, reload } = useSupplierDirectory();
  const [filters, setFilters] = React.useState<DirectoryFilters>(() => ({ ...DEFAULT_FILTERS, tab: readDirectoryTab(params.get("type")) }));
  const openKey = params.get("open");
  const [partnerTarget, setPartnerTarget] = React.useState<PartnerEditorTarget | null>(null);
  const [stockTarget, setStockTarget] = React.useState<StockEditorTarget | null>(null);
  const [deleteFor, setDeleteFor] = React.useState<StockSupplierRecord | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const entries = React.useMemo(() => (data ? buildDirectoryEntries(data) : []), [data]);
  const visible = React.useMemo(() => filterDirectory(entries, filters), [entries, filters]);
  const counts = React.useMemo(() => tabCounts(entries), [entries]);
  const categories = React.useMemo(() => categoryOptions(entries), [entries]);
  const attentionCount = React.useMemo(() => filterDirectory(entries, { ...filters, attention: true, withLogins: false, category: "", q: "" }).length, [entries, filters]);
  const loginCount = React.useMemo(() => filterDirectory(entries, { ...filters, attention: false, withLogins: true, category: "", q: "" }).length, [entries, filters]);
  const rows = data?.rows ?? [];
  const stockSuppliers = React.useMemo(() => rows.flatMap((row) => (row.stock ? [row.stock] : [])), [rows]);
  const linkedStock = React.useMemo(() => new Map(rows.flatMap((row) => (row.stock && row.laundry ? [[row.stock.id, row.laundry.name] as [string, string]] : []))), [rows]);
  const partnerNames = React.useMemo(() => new Map(rows.flatMap((row) => (row.laundry ? [[row.laundry.id, row.laundry.name] as [string, string]] : []))), [rows]);
  const openEntry = openKey ? entries.find((entry) => entry.key === openKey) ?? null : null;

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function setTab(tab: DirectoryTab) {
    setFilters((current) => ({ ...current, tab }));
    setParam("type", tab === "all" ? null : tab);
  }

  function setSort(sort: DirectorySort) {
    setFilters((current) => ({ ...current, sort, dir: current.sort === sort && current.dir === "asc" ? "desc" : "asc" }));
  }

  const actions = {
    onEditPartner: (partner: LaundryPartnerRecord) => setPartnerTarget({ mode: "edit", partner }),
    onEditStock: (stock: StockSupplierRecord) => setStockTarget({ mode: "edit", supplier: stock }),
    onDeleteStock: (stock: StockSupplierRecord) => setDeleteFor(stock),
  };

  function menuFor(entry: DirectoryEntry): ERowMenuItem[] {
    const partner = entry.row?.laundry;
    const stock = entry.row?.stock;
    return [
      { key: "open", label: "Open", onSelect: () => setParam("open", entry.key) },
      ...(partner ? [{ key: "edit-partner", label: "Edit laundry partner", onSelect: () => actions.onEditPartner(partner) }] : []),
      ...(stock ? [{ key: "edit-stock", label: "Edit stock supplier", onSelect: () => actions.onEditStock(stock) }] : []),
      ...(entry.trade ? [{ key: "trade", label: "Edit in Maintenance", href: MAINTENANCE_HREF }] : []),
      ...(stock ? [{ key: "delete", label: "Delete stock supplier", danger: true, separated: true, onSelect: () => actions.onDeleteStock(stock) }] : []),
    ];
  }

  async function confirmDelete() {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/inventory/suppliers/${deleteFor.id}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast({ title: "Delete failed", description: body?.error ?? `The server refused this (${response.status}).`, variant: "destructive" });
        return;
      }
      toast({ title: "Stock supplier deleted" });
      setDeleteFor(null);
      await reload();
    } catch {
      toast({ title: "No answer from the server", description: "Reload to see whether it was deleted.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  const addMenu: ERowMenuItem[] = [
    { key: "laundry", label: "Laundry partner", onSelect: () => setPartnerTarget({ mode: "create" }) },
    { key: "stock", label: "Stock supplier", onSelect: () => setStockTarget({ mode: "create" }) },
    { key: "trade", label: "Trade (in Maintenance)", href: MAINTENANCE_HREF },
  ];
  const total = entries.length;

  return (
    <div className="space-y-5">
      <EPageHeader
        eyebrow="Operations"
        title="Suppliers"
        description={`Everyone we buy from or hand work to: laundry partners, stock suppliers and trades${data ? ` · ${total} supplier${total === 1 ? "" : "s"}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" variant="outline" disabled={!visible.length} onClick={() => downloadCsv(visible)}>Export</EButton>
            <ERowMenu label="Add supplier" trigger="Add supplier ▾" items={addMenu} />
          </div>
        }
      />
      {tabs}
      <div role="tablist" aria-label="Supplier types" className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--e-border))]">
        {DIRECTORY_TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={filters.tab === tab.id} onClick={() => setTab(tab.id)} className={`min-h-10 whitespace-nowrap px-2.5 text-[0.875rem] ${filters.tab === tab.id ? "border-b-2 border-[hsl(var(--e-primary))] font-[600]" : "text-[hsl(var(--e-muted-foreground))]"}`}>
            {tab.label} {data ? counts[tab.id] : ""}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <EInput className="w-full sm:w-[240px]" aria-label="Search suppliers" placeholder="Search name, contact, category" value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} />
        <Chip on={filters.attention} onClick={() => setFilters((current) => ({ ...current, attention: !current.attention }))}>Needs attention {data ? attentionCount : ""}</Chip>
        <Chip on={filters.withLogins} onClick={() => setFilters((current) => ({ ...current, withLogins: !current.withLogins }))}>Has portal logins {data ? loginCount : ""}</Chip>
        <ESelect aria-label="Category" className="w-auto" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}>
          <option value="">Category: all</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </ESelect>
      </div>
      {data?.danglingLinks.length ? (
        <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-warning,var(--e-danger)))]">
          {data.danglingLinks.length} laundry partner link{data.danglingLinks.length === 1 ? " points" : "s point"} to a stock supplier that no longer exists. Edit the partner to relink it.
        </p>
      ) : null}
      {data && data.trades === undefined ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Trades could not be loaded; laundry partners and stock suppliers are shown.</p> : null}
      {load.status === "stale" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message} Showing the last list loaded. <button type="button" className="underline" onClick={() => void reload()}>Retry</button></p> : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <ECard className="min-w-0 flex-1 overflow-hidden p-0">
          {load.status === "loading" ? (
            <p role="status" className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading suppliers…</p>
          ) : load.status === "failed" ? (
            <div className="space-y-3 py-12 text-center text-[0.875rem]">
              <p role="alert" className="text-[hsl(var(--e-danger))]">{load.message}</p>
              <EButton size="sm" variant="outline" onClick={() => void reload()}>Retry</EButton>
            </div>
          ) : visible.length === 0 ? (
            <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{total ? "No supplier matches these filters." : "No suppliers yet. Use Add supplier."}</p>
          ) : (
            <>
              <SupplierTable entries={visible} openKey={openKey} sort={filters.sort} dir={filters.dir} onSort={setSort} onOpen={(entry) => setParam("open", entry.key)} menuFor={menuFor} />
              <p className="px-3 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">On time: share of runs back within the agreed turnaround, last 30 days. &quot;–&quot; where nothing is measured.</p>
            </>
          )}
        </ECard>
        {openKey && !openEntry && load.status !== "loading" ? (
          <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] lg:w-[350px]">That supplier was not found. <button type="button" className="underline" onClick={() => setParam("open", null)}>Close</button></p>
        ) : null}
        <SupplierPanel
          entry={openEntry}
          laundryUsers={data?.laundryUsers ?? []}
          partnerNames={partnerNames}
          onClose={() => setParam("open", null)}
          onSaved={() => void reload()}
          {...actions}
        />
      </div>

      <LaundryPartnerEditor
        target={partnerTarget}
        stockSuppliers={stockSuppliers}
        linkedStock={linkedStock}
        laundryUsers={data?.laundryUsers ?? []}
        partnerNames={partnerNames}
        onClose={() => setPartnerTarget(null)}
        onSaved={() => {
          toast({ title: "Laundry partner saved" });
          setPartnerTarget(null);
          void reload();
        }}
      />
      <StockSupplierEditor
        target={stockTarget}
        onClose={() => setStockTarget(null)}
        onSaved={() => {
          toast({ title: "Stock supplier saved" });
          setStockTarget(null);
          void reload();
        }}
      />
      <EConfirmModal
        open={Boolean(deleteFor)}
        onClose={() => setDeleteFor(null)}
        title={`Delete ${deleteFor?.name ?? "supplier"}?`}
        description="This removes the supplier from the inventory catalog. A linked laundry partner stays, with its runs and team; only the link is removed."
        confirmLabel="Delete supplier"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
