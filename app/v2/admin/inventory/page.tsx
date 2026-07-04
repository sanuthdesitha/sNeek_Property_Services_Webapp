import Link from "next/link";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { listSupplierCatalog } from "@/lib/inventory/suppliers";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EStatCard,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { AlertTriangle, Package, PackageCheck, ShoppingCart, Truck } from "lucide-react";

export const metadata = { title: "Inventory · Estate admin" };
export const dynamic = "force-dynamic";

const PENDING_SHOPPING_STATUSES = ["DRAFT", "ACTIVE", "SUBMITTED", "APPROVED"];
const PENDING_STOCK_RUN_STATUSES = ["DRAFT", "ACTIVE", "SUBMITTED"];

async function getInventorySummary() {
  const [itemCount, openShoppingRuns, activeStockCounts, onHandAgg, suppliers, lowStock] = await Promise.all([
    db.inventoryItem.count({ where: { isActive: true } }).catch(() => 0),
    db.shoppingRun.count({ where: { status: { in: PENDING_SHOPPING_STATUSES as any } } }).catch(() => 0),
    db.stockRun.count({ where: { status: { in: PENDING_STOCK_RUN_STATUSES as any } } }).catch(() => 0),
    db.heldStock
      .aggregate({ where: { status: "HELD", quantity: { gt: 0 } }, _sum: { quantity: true }, _count: true })
      .catch(() => null),
    listSupplierCatalog().catch(() => [] as Awaited<ReturnType<typeof listSupplierCatalog>>),
    // Property × item lines below their reorder threshold — the same low-stock
    // definition the legacy hub uses, read directly from PropertyStock.
    db.propertyStock
      .findMany({
        where: { reorderThreshold: { gt: 0 } },
        select: {
          id: true,
          onHand: true,
          reorderThreshold: true,
          item: { select: { name: true } },
          property: { select: { name: true, suburb: true } },
        },
        take: 400,
      })
      .catch(() => []),
  ]);

  const lowStockLines = lowStock.filter((s) => s.onHand < s.reorderThreshold);
  const onHandUnits = Math.round((onHandAgg?._sum?.quantity ?? 0) * 100) / 100;

  return {
    itemCount,
    openShoppingRuns,
    activeStockCounts,
    onHandUnits,
    onHandHoldings: onHandAgg?._count ?? 0,
    suppliersCount: suppliers.length,
    lowStockLines,
  };
}

export default async function AdminInventoryPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const s = await getInventorySummary();

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Commercial"
        title="Inventory & supplies"
        description="Items, per-property stock, counts, and shopping runs."
        actions={
          <Link href="/admin/inventory">
            <EButton variant="gold" size="sm">Open inventory hub</EButton>
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <EStatCard label="Active items" value={String(s.itemCount)} delta="catalog" deltaTone="neutral" icon={<Package className="h-4 w-4" />} />
        <EStatCard label="Low-stock lines" value={String(s.lowStockLines.length)} delta={s.lowStockLines.length > 0 ? "below reorder" : "all stocked"} deltaTone={s.lowStockLines.length > 0 ? "danger" : "neutral"} icon={<AlertTriangle className="h-4 w-4" />} />
        <EStatCard label="Open shopping runs" value={String(s.openShoppingRuns)} delta="in progress" deltaTone="neutral" icon={<ShoppingCart className="h-4 w-4" />} />
        <EStatCard label="On-hand units" value={String(s.onHandUnits)} delta={`${s.onHandHoldings} holding${s.onHandHoldings === 1 ? "" : "s"}`} deltaTone="neutral" icon={<PackageCheck className="h-4 w-4" />} />
        <EStatCard label="Suppliers" value={String(s.suppliersCount)} delta="catalog" deltaTone="neutral" icon={<Truck className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardHeader className="flex-row items-center justify-between">
          <ECardTitle>Low stock</ECardTitle>
          <Link href="/admin/inventory?tab=properties&filter=low"><EButton variant="ghost" size="sm">Manage stock</EButton></Link>
        </ECardHeader>
        <ECardBody className="pt-0">
          {s.lowStockLines.length === 0 ? (
            <EEmptyState eyebrow="All stocked" title="No low-stock lines" description="Every tracked property item is at or above its reorder threshold." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Item", "Property", "On hand", "Reorder at", "Status"].map((h) => (
                      <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.lowStockLines.slice(0, 25).map((line) => (
                    <tr key={line.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                      <td className="px-3 py-3 font-medium">{line.item?.name ?? "Unknown item"}</td>
                      <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))]">{line.property?.name ?? "—"}{line.property?.suburb ? ` · ${line.property.suburb}` : ""}</td>
                      <td className="px-3 py-3"><span className="e-numeral text-[0.9375rem]">{line.onHand}</span></td>
                      <td className="px-3 py-3 tabular-nums text-[hsl(var(--e-text-secondary))]">{line.reorderThreshold}</td>
                      <td className="px-3 py-3"><EBadge tone="danger" soft>Low</EBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live summary · items, counts, shopping runs, suppliers, and delivery profiles open in the live inventory hub.</p>
    </div>
  );
}
