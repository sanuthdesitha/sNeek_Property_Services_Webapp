import { Role } from "@prisma/client";
import {
  AlertTriangle,
  ClipboardList,
  Package,
  PackageCheck,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listSupplierCatalog } from "@/lib/inventory/suppliers";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EKpiLink } from "@/components/v2/admin/estate-kit";
import {
  InventoryChipTabs,
  type InventoryTab,
} from "@/components/v2/admin/inventory/inventory-chip-tabs";
import { EstateItems } from "@/components/v2/admin/inventory/estate-items";
import { EstateSuppliers } from "@/components/v2/admin/inventory/estate-suppliers";
import { EstateOnHand } from "@/components/v2/admin/inventory/estate-on-hand";
import { EstateStockRuns } from "@/components/v2/admin/inventory/estate-stock-runs";
import { EstateShoppingRuns } from "@/components/v2/admin/inventory/estate-shopping-runs";
import {
  EstatePropertyMatrix,
  STALE_RESTOCK_DAYS,
  normalizePropertyInventoryFilter,
  type EstatePropertyInventoryRow,
  type EstatePropertyInventoryTotals,
} from "@/components/v2/admin/inventory/estate-property-matrix";

export const metadata = { title: "Inventory · Estate admin" };
export const dynamic = "force-dynamic";

const PENDING_SHOPPING_STATUSES = ["DRAFT", "ACTIVE", "SUBMITTED", "APPROVED"];
const PENDING_STOCK_RUN_STATUSES = ["DRAFT", "ACTIVE", "SUBMITTED"];

const TAB_KEYS: InventoryTab[] = [
  "items",
  "properties",
  "on-hand",
  "stock-counts",
  "shopping-runs",
  "suppliers",
];

function normalizeTab(value: string | undefined): InventoryTab {
  return (TAB_KEYS as string[]).includes(value ?? "") ? (value as InventoryTab) : "items";
}

/**
 * Roll-up for the property overview — mirrors the v1 hub query so the KPI strip
 * and the "By Property" matrix share one cheap fetch.
 */
async function getPropertyOverview(): Promise<{
  rows: EstatePropertyInventoryRow[];
  totals: EstatePropertyInventoryTotals;
}> {
  const properties = await db.property.findMany({
    where: { isActive: true, inventoryEnabled: true },
    include: {
      client: { select: { name: true } },
      propertyStock: { include: { item: { select: { name: true } } } },
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
        where: { txType: "RESTOCKED", propertyStock: { propertyId: { in: propertyIds } } },
        select: { createdAt: true, propertyStock: { select: { propertyId: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const lastRestockByProperty = new Map<string, Date>();
  for (const tx of restocks) {
    const pid = tx.propertyStock?.propertyId;
    if (!pid) continue;
    if (!lastRestockByProperty.has(pid)) lastRestockByProperty.set(pid, tx.createdAt);
  }

  const rows: EstatePropertyInventoryRow[] = properties.map((p) => {
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
        dedupedShoppingRuns.set(run.id, { id: run.id, title: run.title, status: String(run.status) });
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
  const totals: EstatePropertyInventoryTotals = {
    properties: rows.length,
    lowStock: rows.filter((r) => r.lowStockItems.length > 0).length,
    pendingShopping: rows.reduce((sum, r) => sum + r.pendingShoppingRuns, 0),
    stale: rows.filter((r) => {
      if (r.trackedItems === 0) return false;
      const last = r.lastRestockAt instanceof Date ? r.lastRestockAt : null;
      return !last || last.getTime() < staleThreshold;
    }).length,
  };

  return { rows, totals };
}

export default async function EstateInventoryPage({
  searchParams,
}: {
  searchParams?: { tab?: string; filter?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const tab = normalizeTab(searchParams?.tab);
  const filter = normalizePropertyInventoryFilter(searchParams?.filter);

  const { rows: propertyRows, totals: propertyTotals } = await getPropertyOverview();
  const [itemCount, openShoppingRuns, activeStockCounts, suppliers, onHandAgg] = await Promise.all([
    db.inventoryItem.count({ where: { isActive: true } }),
    db.shoppingRun.count({ where: { status: { in: PENDING_SHOPPING_STATUSES as any } } }),
    db.stockRun.count({ where: { status: { in: PENDING_STOCK_RUN_STATUSES as any } } }),
    listSupplierCatalog(),
    db.heldStock.aggregate({
      where: { status: "HELD", quantity: { gt: 0 } },
      _sum: { quantity: true },
      _count: true,
    }),
  ]);

  const lowStockLines = propertyRows.reduce((sum, row) => sum + row.lowStockItems.length, 0);
  const onHandUnits = Math.round((onHandAgg._sum.quantity ?? 0) * 100) / 100;
  const onHandLines = onHandAgg._count;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Commercial"
        title="Inventory & supplies"
        description="Items, per-property stock, counts, shopping runs, and suppliers — all in one place."
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <EKpiLink
          label="Active items"
          value={itemCount}
          icon={<Package />}
          href="/v2/admin/inventory?tab=items"
        />
        <EKpiLink
          label="Low stock lines"
          value={lowStockLines}
          icon={<AlertTriangle />}
          tone={lowStockLines > 0 ? "warning" : "neutral"}
          href="/v2/admin/inventory?tab=properties&filter=low"
        />
        <EKpiLink
          label="Open shopping runs"
          value={openShoppingRuns}
          icon={<ShoppingCart />}
          tone={openShoppingRuns > 0 ? "info" : "neutral"}
          href="/v2/admin/inventory?tab=shopping-runs"
        />
        <EKpiLink
          label={onHandLines > 0 ? `On-hand · ${onHandLines} holding(s)` : "On-hand units"}
          value={onHandUnits}
          icon={<PackageCheck />}
          tone={onHandUnits > 0 ? "info" : "neutral"}
          href="/v2/admin/inventory?tab=on-hand"
        />
        <EKpiLink
          label="Active stock counts"
          value={activeStockCounts}
          icon={<ClipboardList />}
          tone={activeStockCounts > 0 ? "info" : "neutral"}
          href="/v2/admin/inventory?tab=stock-counts"
        />
        <EKpiLink
          label="Suppliers"
          value={suppliers.length}
          icon={<Truck />}
          tone="gold"
          href="/v2/admin/inventory?tab=suppliers"
        />
      </section>

      <InventoryChipTabs active={tab} />

      <div className="min-w-0">
        {tab === "items" ? <EstateItems /> : null}
        {tab === "properties" ? (
          <EstatePropertyMatrix rows={propertyRows} totals={propertyTotals} filter={filter} />
        ) : null}
        {tab === "on-hand" ? <EstateOnHand /> : null}
        {tab === "stock-counts" ? <EstateStockRuns /> : null}
        {tab === "shopping-runs" ? <EstateShoppingRuns /> : null}
        {tab === "suppliers" ? <EstateSuppliers /> : null}
      </div>
    </div>
  );
}
