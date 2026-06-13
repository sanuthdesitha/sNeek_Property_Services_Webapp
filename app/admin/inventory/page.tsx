import { Role } from "@prisma/client";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Package,
  SendToBack,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { KpiTile } from "@/components/charts";
import { listSupplierCatalog } from "@/lib/inventory/suppliers";
import { listClientDeliveryProfiles } from "@/lib/commercial/delivery-profiles";
import {
  InventoryTabNav,
  type InventoryTabKey,
} from "@/components/inventory/inventory-tab-nav";
import { InventoryItemsWorkspace } from "@/components/inventory/inventory-items-workspace";
import { ShoppingRunsWorkspace } from "@/components/inventory/shopping-runs-workspace";
import { SuppliersWorkspace } from "@/components/inventory/suppliers-workspace";
import { DeliveryProfilesWorkspace } from "@/components/inventory/delivery-profiles-workspace";
import { StockRunWorkspace } from "@/components/inventory/stock-run-workspace";
import {
  PropertyInventoryOverview,
  STALE_RESTOCK_DAYS,
  normalizePropertyInventoryFilter,
  type PropertyInventoryRow,
  type PropertyInventoryTotals,
} from "@/components/inventory/property-inventory-overview";

const PENDING_SHOPPING_STATUSES = ["DRAFT", "ACTIVE", "SUBMITTED", "APPROVED"];
const PENDING_STOCK_RUN_STATUSES = ["DRAFT", "ACTIVE", "SUBMITTED"];

const TAB_KEYS: InventoryTabKey[] = [
  "items",
  "properties",
  "stock-counts",
  "shopping-runs",
  "delivery",
  "suppliers",
];

function normalizeTab(value: string | undefined): InventoryTabKey {
  return (TAB_KEYS as string[]).includes(value ?? "") ? (value as InventoryTabKey) : "items";
}

/**
 * Roll-up summary for the property overview. Mirrors the query the standalone
 * /admin/inventory/properties page used, so the KPI strip and the "By Property"
 * tab share one cheap fetch.
 */
async function getPropertyOverview(): Promise<{
  rows: PropertyInventoryRow[];
  totals: PropertyInventoryTotals;
}> {
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

  const rows: PropertyInventoryRow[] = properties.map((p) => {
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

  const staleThreshold = Date.now() - STALE_RESTOCK_DAYS * 24 * 60 * 60 * 1000;
  const totals: PropertyInventoryTotals = {
    properties: rows.length,
    lowStock: rows.filter((r) => r.lowStockItems.length > 0).length,
    pendingShopping: rows.reduce((sum, r) => sum + r.pendingShoppingRuns, 0),
    stale: rows.filter((r) => {
      if (r.trackedItems === 0) return false;
      return !r.lastRestockAt || r.lastRestockAt.getTime() < staleThreshold;
    }).length,
  };

  return { rows, totals };
}

export default async function InventoryHubPage({
  searchParams,
}: {
  searchParams?: { tab?: string; filter?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const tab = normalizeTab(searchParams?.tab);
  const filter = normalizePropertyInventoryFilter(searchParams?.filter);

  // Summary metrics — all cheaply computed from existing inventory queries.
  const { rows: propertyRows, totals: propertyTotals } = await getPropertyOverview();
  const [
    itemCount,
    openShoppingRuns,
    activeStockCounts,
    suppliers,
    deliveryProfiles,
  ] = await Promise.all([
    db.inventoryItem.count({ where: { isActive: true } }),
    db.shoppingRun.count({ where: { status: { in: PENDING_SHOPPING_STATUSES as any } } }),
    db.stockRun.count({ where: { status: { in: PENDING_STOCK_RUN_STATUSES as any } } }),
    listSupplierCatalog(),
    listClientDeliveryProfiles(),
  ]);

  // Low-stock count: number of (property × item) lines below reorder threshold,
  // summed across the property overview rows (same logic as the per-property view).
  const lowStockLines = propertyRows.reduce((sum, row) => sum + row.lowStockItems.length, 0);
  const suppliersCount = suppliers.length;
  const deliveryProfilesCount = deliveryProfiles.length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Boxes />}
        title="Inventory & Supplies"
        description="Items, per-property stock, counts, shopping runs, delivery profiles, and suppliers — all in one place."
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label="Active items"
          value={itemCount}
          icon={<Package />}
          tone="primary"
          href="/admin/inventory?tab=items"
        />
        <KpiTile
          label="Low stock lines"
          value={lowStockLines}
          icon={<AlertTriangle />}
          tone={lowStockLines > 0 ? "warning" : "neutral"}
          href="/admin/inventory?tab=properties&filter=low"
        />
        <KpiTile
          label="Open shopping runs"
          value={openShoppingRuns}
          icon={<ShoppingCart />}
          tone={openShoppingRuns > 0 ? "info" : "neutral"}
          href="/admin/inventory?tab=shopping-runs"
        />
        <KpiTile
          label="Active stock counts"
          value={activeStockCounts}
          icon={<ClipboardList />}
          tone={activeStockCounts > 0 ? "info" : "neutral"}
          href="/admin/inventory?tab=stock-counts"
        />
        <KpiTile
          label="Suppliers"
          value={suppliersCount}
          icon={<Truck />}
          tone="accent"
          href="/admin/inventory?tab=suppliers"
        />
        <KpiTile
          label="Delivery profiles"
          value={deliveryProfilesCount}
          icon={<SendToBack />}
          tone="accent"
          href="/admin/inventory?tab=delivery"
        />
      </section>

      <InventoryTabNav active={tab} />

      <div className="min-w-0">
        {tab === "items" ? <InventoryItemsWorkspace /> : null}
        {tab === "properties" ? (
          <PropertyInventoryOverview rows={propertyRows} totals={propertyTotals} filter={filter} />
        ) : null}
        {tab === "stock-counts" ? (
          <StockRunWorkspace
            apiBase="/api/admin/stock-runs"
            title="Stock Counts"
            description="Run full inventory counts, review counted stock, and apply the adjustments back to property inventory."
            hideHeader
          />
        ) : null}
        {tab === "shopping-runs" ? <ShoppingRunsWorkspace /> : null}
        {tab === "delivery" ? <DeliveryProfilesWorkspace /> : null}
        {tab === "suppliers" ? <SuppliersWorkspace /> : null}
      </div>
    </div>
  );
}
