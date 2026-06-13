import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { PropertyInventoryFilterTabs } from "./property-inventory-filter-tabs";

export type PropertyInventoryFilter = "all" | "low" | "pending" | "stale";

export type PropertyInventoryRow = {
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
  lastRestockAt: Date | null;
};

export type PropertyInventoryTotals = {
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

/**
 * Per-property inventory overview (formerly /admin/inventory/properties). Pure
 * presentational component — all data fetching stays in the hub server page.
 */
export function PropertyInventoryOverview({
  rows,
  totals,
  filter,
}: {
  rows: PropertyInventoryRow[];
  totals: PropertyInventoryTotals;
  filter: PropertyInventoryFilter;
}) {
  const now = Date.now();
  const staleThreshold = now - STALE_RESTOCK_DAYS * 24 * 60 * 60 * 1000;

  const filtered = rows.filter((row) => {
    if (filter === "low") return row.lowStockItems.length > 0;
    if (filter === "pending") return row.pendingShoppingRuns > 0;
    if (filter === "stale") {
      if (row.trackedItems === 0) return false;
      return !row.lastRestockAt || row.lastRestockAt.getTime() < staleThreshold;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Stock levels, pending shopping runs, and recent restocks for every inventory-enabled property in one place.
      </p>

      <PropertyInventoryFilterTabs current={filter} totals={totals} />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No properties match this filter.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((row) => (
            <PropertyCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function PropertyCard({ row }: { row: PropertyInventoryRow }) {
  const restockLabel = row.lastRestockAt
    ? `${formatDistanceToNow(row.lastRestockAt, { addSuffix: true })}`
    : "No restock recorded";
  const restockTone =
    !row.lastRestockAt || row.lastRestockAt.getTime() < Date.now() - STALE_RESTOCK_DAYS * 24 * 60 * 60 * 1000
      ? "warning"
      : "success";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{row.name}</CardTitle>
            <CardDescription className="truncate">
              {row.suburb ? `${row.suburb} · ` : ""}
              {row.client.name}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <Link href={`/admin/properties/${row.id}#inventory`}>
              View details
              <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
        <MetricBlock
          label="Below reorder"
          value={row.lowStockItems.length}
          tone={row.lowStockItems.length > 0 ? "warning" : "neutral"}
        >
          {row.lowStockItems.length > 0 ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {row.lowStockItems
                .slice(0, 3)
                .map((it) => it.name)
                .join(", ")}
              {row.lowStockItems.length > 3 ? `, +${row.lowStockItems.length - 3} more` : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{row.trackedItems} items tracked</p>
          )}
        </MetricBlock>
        <MetricBlock
          label="Pending shopping"
          value={row.pendingShoppingRuns}
          tone={row.pendingShoppingRuns > 0 ? "info" : "neutral"}
        >
          {row.pendingShoppingRunsList.length > 0 ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {row.pendingShoppingRunsList
                .slice(0, 2)
                .map((r) => `${r.title} (${r.status.toLowerCase()})`)
                .join(", ")}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No active runs</p>
          )}
        </MetricBlock>
        <MetricBlock label="Last restock" value={null}>
          <div className="mt-1">
            <StatusPill variant={restockTone === "warning" ? "warning" : "success"} size="sm">
              {restockLabel}
            </StatusPill>
          </div>
          {row.openStockRuns > 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {row.openStockRuns} open count{row.openStockRuns === 1 ? "" : "s"}
            </p>
          ) : null}
        </MetricBlock>
      </CardContent>
    </Card>
  );
}

function MetricBlock({
  label,
  value,
  tone = "neutral",
  children,
}: {
  label: string;
  value: number | null;
  tone?: "neutral" | "info" | "warning";
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === "warning" ? "text-warning" : tone === "info" ? "text-info" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-surface-raised p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {value !== null ? <p className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</p> : null}
      {children}
    </div>
  );
}
