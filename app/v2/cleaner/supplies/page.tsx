import { UrgentStockWorkspace } from "@/components/inventory/urgent-stock-workspace";
import { PurchaseAsksCard } from "@/components/v2/cleaner/purchase-asks-card";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { db } from "@/lib/db";
import { ECard, EPageHeader } from "@/components/v2/ui/primitives";
import { ShoppingLauncher } from "@/components/v2/cleaner/shopping-launcher";
import { OnHandView } from "@/components/v2/cleaner/on-hand-view";
import { RestockPanel } from "@/components/v2/cleaner/restock-panel";
import { StockRunWorkspace } from "@/components/v2/cleaner/stock-run-workspace";
import { QuickScanLauncher } from "@/components/v2/cleaner/quick-scan-launcher";
import { SegmentTabs } from "@/components/v2/cleaner/portal/segment-tabs";
import { SuppliesTodo } from "@/components/v2/cleaner/supplies/supplies-todo";
import { loadSuppliesTodo } from "@/components/v2/cleaner/supplies/load-supplies-todo";
import { countsTools, resolveSuppliesTab, suppliesTabs, type SuppliesTabKey } from "@/lib/cleaner/supplies-view";

export const metadata = { title: "Supplies · Estate cleaner" };
export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<SuppliesTabKey, string> = {
  todo: "What is waiting for you: office asks, your shopping run, counts you were asked to do and urgent stock you reported.",
  shopping: "Choose what needs buying, start the run, then track receipts, payment, and time in the run workspace.",
  counts: "Count stock on site, scan a shelf label to adjust it, or record a restock.",
  "urgent-stock": "Tell the office about a shortage at a property you clean, and follow what happens to it.",
  "my-stock": "Record supplies you personally hold before delivering them to a property.",
};

/**
 * Cleaner Supplies (approved board, 2026-11): To do · Shopping · Counts ·
 * Urgent · My stock. Each section keeps the gate its old page used: Shopping
 * needs the `shopping` module, Stock counts the `stockRuns` module; a disabled
 * module drops its tab and cannot be reached by `?tab=`. Old links keep their
 * meaning: `?tab=quick-scan|restock|stock-runs` open that tool inside Counts,
 * and /restock, /stock-runs, /shopping still redirect here.
 */
export default async function CleanerSuppliesPage({
  searchParams,
}: {
  searchParams?: { tab?: string; tool?: string; propertyId?: string };
}) {
  const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();
  const modules = {
    shopping: isCleanerModuleEnabled(settings, "shopping"),
    stockRuns: isCleanerModuleEnabled(settings, "stockRuns"),
  };
  const { tab: active, tool } = resolveSuppliesTab(searchParams?.tab, searchParams?.tool, modules);

  // Property list for the launchers that need one.
  const needsProperties = active === "shopping" || active === "my-stock" || (active === "counts" && tool === "quick-scan");
  const properties = needsProperties
    ? await db.property
        .findMany({ where: { isActive: true }, select: { id: true, name: true, suburb: true }, orderBy: { name: "asc" } })
        .catch(() => [])
    : [];

  const todo = active === "todo" ? await loadSuppliesTodo(session.user.id, modules.shopping) : null;

  return (
    <div className="space-y-5">
      <EPageHeader eyebrow="Inventory" title="Supplies" description={DESCRIPTIONS[active]} />

      <SegmentTabs
        label="Supplies sections"
        activeKey={active}
        tabs={suppliesTabs(modules).map((tab) => ({
          key: tab.key,
          label: tab.label,
          href: `/v2/cleaner/supplies?tab=${tab.key}`,
          count: tab.key === "todo" && todo?.scanTasks ? todo.scanTasks.length || undefined : undefined,
        }))}
      />

      {active === "todo" && todo ? (
        <SuppliesTodo shoppingEnabled={modules.shopping} scanTasks={todo.scanTasks} runs={todo.runs} urgentReports={todo.urgentReports} />
      ) : null}

      {active === "counts" ? (
        <div className="space-y-4">
          <SegmentTabs
            label="Count tools"
            activeKey={tool}
            className="max-w-md"
            tabs={countsTools(modules).map((entry) => ({
              key: entry.key,
              label: entry.label,
              href: `/v2/cleaner/supplies?tab=counts&tool=${entry.key}`,
            }))}
          />
          {tool === "stock-runs" ? <StockRunWorkspace apiBase="/api/cleaner/stock-runs" /> : null}
          {tool === "quick-scan" ? <QuickScanLauncher properties={properties} /> : null}
          {tool === "restock" ? <RestockPanel /> : null}
        </div>
      ) : null}

      {active === "urgent-stock" ? (
        <ECard className="p-4 sm:p-6">
          <UrgentStockWorkspace isAdmin={false} panel />
        </ECard>
      ) : null}

      {active === "my-stock" ? <OnHandView key={session.user.id} properties={properties} /> : null}

      {active === "shopping" ? (
        <div className="space-y-6">
          <PurchaseAsksCard />
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
                Stock you&apos;re holding that hasn&apos;t been dropped at a unit yet. Deliver it to update that unit&apos;s count.
              </p>
            </div>
            <OnHandView properties={properties} />
          </section>
        </div>
      ) : null}
    </div>
  );
}
