import Link from "next/link";
import { Role } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ArrowRight, Boxes, ClipboardList, ShoppingCart } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { PropertyFilterTabs } from "./filter-tabs";

type StaleFilter = "all" | "low" | "pending" | "stale";

type PropertyRow = {
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

const PENDING_SHOPPING_STATUSES = ["DRAFT", "ACTIVE", "SUBMITTED", "APPROVED"];
const PENDING_STOCK_RUN_STATUSES = ["DRAFT", "ACTIVE", "SUBMITTED"];
const STALE_RESTOCK_DAYS = 30;

export default async function PropertyInventoryDashboard({
  searchParams,
}: {
  searchParams?: { filter?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const filter = normalizeFilter(searchParams?.filter);

  const properties = await db.property.findMany({
    where: { isActive: true, inventoryEnabled: true },
    include: {
      client: { select: { name: true } },
      propertyStock: {
        include: { item: { select: { name: true } } },
      },
      shoppingRunLines: {
        where: { shoppingRun: { status: { in: PENDING_SHOPPING_STATUSES as any } } },
        select: {
          shoppingRunId: true,
          shoppingRun: { select: { id: true, title: true, status: true } },
        },
      },
      stockRuns: {
        where: { status: { in: PENDING_STOCK_RUN_STATUSES as any } },
        select: { id: true, status: true },
      },
    },
    orderBy: { name: "asc" },
    take: 200,
  });

  const propertyIds = properties.map((p) => p.id);
  const restocks = propertyIds.length
    ? await db.stockTx.findMany({
        where: {
          txType: "RESTOCKED",
          propertyStock: { propertyId: { in: propertyIds } },
        },
        select: {
          createdAt: true,
          propertyStock: { select: { propertyId: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const lastRestockByProperty = new Map<string, Date>();
  for (const tx of restocks) {
    const pid = tx.propertyStock?.propertyId;
    if (!pid) continue;
    if (!lastRestockByProperty.has(pid)) {
      lastRestockByProperty.set(pid, tx.createdAt);
    }
  }

  const rows: PropertyRow[] = properties.map((p) => {
    const lowStockItems = p.propertyStock
      .filter((s) => s.reorderThreshold > 0 && s.onHand < s.reorderThreshold)
      .map((s) => ({
        id: s.id,
        name: s.item?.name ?? "Unknown item",
        onHand: s.onHand,
        reorderThreshold: s.reorderThreshold,
      }));

    const dedupedShoppingRuns = new Map<string, { id: string; title: string; status: string }>();
    for (const line of p.shoppingRunLines) {
      const run = line.shoppingRun;
      if (!run) continue;
      if (!dedupedShoppingRuns.has(run.id)) {
        dedupedShoppingRuns.set(run.id, {
          id: run.id,
          title: run.title,
          status: String(run.status),
        });
      }
    }

    return {
      id: p.id,
      name: p.name,
      address: p.address,
      suburb: p.suburb,
      inventoryEnabled: p.inventoryEnabled,
      client: { name: p.client?.name ?? "Unknown client" },
      trackedItems: p.propertyStock.length,
      lowStockItems,
      pendingShoppingRuns: dedupedShoppingRuns.size,
      pendingShoppingRunsList: Array.from(dedupedShoppingRuns.values()),
      openStockRuns: p.stockRuns.length,
      lastRestockAt: lastRestockByProperty.get(p.id) ?? null,
    };
  });

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

  const totals = {
    properties: rows.length,
    lowStock: rows.filter((r) => r.lowStockItems.length > 0).length,
    pendingShopping: rows.reduce((sum, r) => sum + r.pendingShoppingRuns, 0),
    stale: rows.filter((r) => {
      if (r.trackedItems === 0) return false;
      return !r.lastRestockAt || r.lastRestockAt.getTime() < staleThreshold;
    }).length,
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Boxes />}
        title="Property inventory overview"
        description="Stock levels, pending shopping runs, and recent restocks for every inventory-enabled property in one place."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/inventory">Inventory items</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/stock-runs">Stock counts</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/shopping-runs">Shopping runs</Link>
            </Button>
          </>
        }
      />
      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-4">
          <SummaryStat label="Properties" value={totals.properties} icon={<Boxes className="size-4" />} />
          <SummaryStat
            label="Below reorder"
            value={totals.lowStock}
            tone={totals.lowStock > 0 ? "warning" : "neutral"}
            icon={<AlertTriangle className="size-4" />}
          />
          <SummaryStat
            label="Pending shopping"
            value={totals.pendingShopping}
            tone={totals.pendingShopping > 0 ? "info" : "neutral"}
            icon={<ShoppingCart className="size-4" />}
          />
          <SummaryStat
            label={`No restock >${STALE_RESTOCK_DAYS}d`}
            value={totals.stale}
            tone={totals.stale > 0 ? "warning" : "neutral"}
            icon={<ClipboardList className="size-4" />}
          />
        </CardContent>
      </Card>

      <PropertyFilterTabs current={filter} totals={totals} />

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

function normalizeFilter(value: string | undefined): StaleFilter {
  if (value === "low" || value === "pending" || value === "stale") return value;
  return "all";
}

function SummaryStat({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: "neutral" | "info" | "warning" | "danger";
}) {
  const toneClass =
    tone === "warning"
      ? "text-warning"
      : tone === "danger"
      ? "text-destructive"
      : tone === "info"
      ? "text-info"
      : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-surface-raised p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function PropertyCard({ row }: { row: PropertyRow }) {
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
