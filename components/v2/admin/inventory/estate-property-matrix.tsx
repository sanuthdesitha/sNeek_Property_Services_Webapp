"use client";

/**
 * ESTATE per-property inventory overview — v2-native read matrix replacing the
 * v1 PropertyInventoryOverview. Pure presentational: all data is computed on the
 * server hub page. Filter tabs drive the ?filter= query (Estate shell preserved).
 * Deep per-property inventory editing links out to the classic property page.
 */
import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ArrowRight, Boxes, Building2, ShoppingCart } from "lucide-react";
import { EBadge, ECard, EStatCard } from "@/components/v2/ui/primitives";
import { EChipTabs, EClassicLink, ETableShell } from "@/components/v2/admin/estate-kit";

export type PropertyInventoryFilter = "all" | "low" | "pending" | "stale";

export type EstatePropertyInventoryRow = {
  id: string;
  name: string;
  address: string;
  suburb: string;
  inventoryEnabled: boolean;
  client: { name: string };
  trackedItems: number;
  lowStockItems: Array<{ id: string; name: string; onHand: number; reorderThreshold: number }>;
  pendingShoppingRuns: number;
  pendingShoppingRunsList: Array<{ id: string; title: string; status: string }>;
  openStockRuns: number;
  lastRestockAt: Date | string | null;
};

export type EstatePropertyInventoryTotals = {
  properties: number;
  lowStock: number;
  pendingShopping: number;
  stale: number;
};

export const STALE_RESTOCK_DAYS = 30;

export function normalizePropertyInventoryFilter(value: string | undefined): PropertyInventoryFilter {
  if (value === "low" || value === "pending" || value === "stale") return value;
  return "all";
}

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

export function EstatePropertyMatrix({
  rows,
  totals,
  filter,
}: {
  rows: EstatePropertyInventoryRow[];
  totals: EstatePropertyInventoryTotals;
  filter: PropertyInventoryFilter;
}) {
  const searchParams = useSearchParams();
  const staleThreshold = Date.now() - STALE_RESTOCK_DAYS * 24 * 60 * 60 * 1000;

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (filter === "low") return row.lowStockItems.length > 0;
        if (filter === "pending") return row.pendingShoppingRuns > 0;
        if (filter === "stale") {
          if (row.trackedItems === 0) return false;
          const last = toDate(row.lastRestockAt);
          return !last || last.getTime() < staleThreshold;
        }
        return true;
      }),
    [rows, filter, staleThreshold],
  );

  function hrefFor(key: PropertyInventoryFilter) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", "properties");
    if (key === "all") params.delete("filter");
    else params.set("filter", key);
    return `/v2/admin/inventory?${params.toString()}`;
  }

  const tabs = [
    { key: "all", label: "All", href: hrefFor("all"), active: filter === "all", count: totals.properties },
    { key: "low", label: "Low stock", href: hrefFor("low"), active: filter === "low", count: totals.lowStock },
    {
      key: "pending",
      label: "Pending",
      href: hrefFor("pending"),
      active: filter === "pending",
      count: totals.pendingShopping,
    },
    { key: "stale", label: "Stale", href: hrefFor("stale"), active: filter === "stale", count: totals.stale },
  ];

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard label="Properties" value={totals.properties} icon={<Building2 className="h-4 w-4" />} />
        <EStatCard
          label="Low stock"
          value={totals.lowStock}
          icon={<AlertTriangle className="h-4 w-4" />}
          delta={totals.lowStock > 0 ? "Below reorder" : undefined}
          deltaTone={totals.lowStock > 0 ? "danger" : "neutral"}
        />
        <EStatCard label="Pending shopping" value={totals.pendingShopping} icon={<ShoppingCart className="h-4 w-4" />} />
        <EStatCard label="Stale (30d+)" value={totals.stale} icon={<Boxes className="h-4 w-4" />} />
      </section>

      <EChipTabs
        tabs={tabs.map((t) => ({
          key: t.key,
          label: t.label,
          href: t.href,
          active: t.active,
          count: t.count,
        }))}
      />

      <ECard className="overflow-hidden p-0">
        {filtered.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No properties match this filter.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Property" },
              { label: "Tracked", align: "center" },
              { label: "Low stock" },
              { label: "Pending", align: "center" },
              { label: "Last restock" },
              { label: "", align: "right" },
            ]}
          >
            {filtered.map((row) => {
              const last = toDate(row.lastRestockAt);
              return (
                <tr key={row.id} className="hover:bg-[hsl(var(--e-surface-raised))]">
                  <td className="px-4 py-3">
                    <span className="font-[550] text-[hsl(var(--e-foreground))]">{row.name}</span>
                    <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      {row.client.name} · {row.suburb}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center e-tnum text-[hsl(var(--e-muted-foreground))]">
                    {row.trackedItems}
                  </td>
                  <td className="px-4 py-3">
                    {row.lowStockItems.length === 0 ? (
                      <span className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {row.lowStockItems.slice(0, 3).map((it) => (
                          <EBadge key={it.id} tone="warning" soft>
                            {it.name} ({it.onHand}/{it.reorderThreshold})
                          </EBadge>
                        ))}
                        {row.lowStockItems.length > 3 ? (
                          <EBadge tone="neutral" soft>
                            +{row.lowStockItems.length - 3}
                          </EBadge>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.pendingShoppingRuns > 0 ? (
                      <EBadge tone="info" soft>
                        {row.pendingShoppingRuns}
                      </EBadge>
                    ) : (
                      <span className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {last ? `${formatDistanceToNow(last)} ago` : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/properties/${row.id}#inventory`}
                      className="inline-flex items-center gap-1 text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline"
                    >
                      Details <ArrowRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </ETableShell>
        )}
      </ECard>

      <div className="flex items-center justify-end">
        <EClassicLink href="/admin/inventory?tab=properties">Open classic property matrix</EClassicLink>
      </div>
    </div>
  );
}
