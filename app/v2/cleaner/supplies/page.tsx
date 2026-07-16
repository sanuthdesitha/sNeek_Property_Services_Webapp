import { Role } from "@prisma/client";
import { Package, PackageSearch, ShoppingCart } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EChipTabs } from "@/components/v2/admin/estate-kit";
import { ShoppingLauncher } from "@/components/v2/cleaner/shopping-launcher";
import { OnHandView } from "@/components/v2/cleaner/on-hand-view";
import { RestockPanel } from "@/components/v2/cleaner/restock-panel";
import { StockRunWorkspace } from "@/components/v2/cleaner/stock-run-workspace";

export const metadata = { title: "Supplies · Estate cleaner" };
export const dynamic = "force-dynamic";

type SuppliesTab = "restock" | "shopping" | "stock-runs";

/**
 * Merged cleaner supplies hub — Restock + Shopping + Stock counts on one screen,
 * behind a single "Supplies" nav entry. Each section keeps the exact auth/module
 * gate its old standalone page used: Restock is ungated (role only), Shopping is
 * gated on the `shopping` module, Stock counts on `stockRuns`. A disabled module
 * simply drops its tab (and can't be reached via ?tab=). The three old routes now
 * redirect here with the matching ?tab=.
 */
export default async function CleanerSuppliesPage({
  searchParams,
}: {
  searchParams?: { tab?: string; propertyId?: string };
}) {
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();

  const showShopping = isCleanerModuleEnabled(settings, "shopping");
  const showStockRuns = isCleanerModuleEnabled(settings, "stockRuns");

  // Build the tab set from what's enabled — Restock is always present.
  const tabs: Array<{ key: SuppliesTab; label: string; icon: React.ReactNode }> = [
    { key: "restock", label: "Restock", icon: <Package className="h-4 w-4" /> },
  ];
  if (showShopping) tabs.push({ key: "shopping", label: "Shopping", icon: <ShoppingCart className="h-4 w-4" /> });
  if (showStockRuns) tabs.push({ key: "stock-runs", label: "Stock counts", icon: <PackageSearch className="h-4 w-4" /> });

  const requested = (searchParams?.tab ?? "").toLowerCase();
  const active: SuppliesTab = tabs.some((t) => t.key === requested)
    ? (requested as SuppliesTab)
    : tabs[0].key;

  // Active property list for the shopping launcher — same query the old page used.
  const properties =
    active === "shopping"
      ? await db.property
          .findMany({
            where: { isActive: true },
            select: { id: true, name: true, suburb: true },
            orderBy: { name: "asc" },
          })
          .catch(() => [])
      : [];

  const description =
    active === "restock"
      ? "Topped up supplies at a property? Record what you added so on-hand counts stay accurate."
      : active === "shopping"
        ? "Choose what needs buying, start the run, then track receipts, payment, and time in the run workspace."
        : "Count actual stock levels on site and submit the run for admin review.";

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Inventory" title="Supplies" description={description} />

      {tabs.length > 1 ? (
        <EChipTabs
          tabs={tabs.map((t) => ({
            key: t.key,
            label: t.label,
            href: `/v2/cleaner/supplies?tab=${t.key}`,
            active: t.key === active,
            icon: t.icon,
          }))}
        />
      ) : null}

      {active === "restock" ? <RestockPanel /> : null}

      {active === "shopping" ? (
        <div className="space-y-6">
          <ShoppingLauncher
            apiPath="/api/cleaner/inventory/shopping-plan"
            runsApiBase="/api/cleaner/inventory/shopping-runs"
            workspaceBasePath="/v2/cleaner/shopping"
            initialPropertyId={searchParams?.propertyId}
          />
          <section className="space-y-3">
            <div>
              <h2 className="e-display-sm">Your on-hand stock</h2>
              <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                Stock you&apos;re holding that hasn&apos;t been dropped at a unit yet. Deliver it to update that unit&apos;s
                count.
              </p>
            </div>
            <OnHandView properties={properties} />
          </section>
        </div>
      ) : null}

      {active === "stock-runs" ? <StockRunWorkspace apiBase="/api/cleaner/stock-runs" /> : null}
    </div>
  );
}
