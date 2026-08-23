import Link from "next/link";
import { Role } from "@prisma/client";
import { Package, PackageSearch, ScanLine, ShoppingCart } from "lucide-react";
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
import { QuickScanLauncher } from "@/components/v2/cleaner/quick-scan-launcher";

export const metadata = { title: "Supplies · Estate cleaner" };
export const dynamic = "force-dynamic";

type SuppliesTab = "quick-scan" | "restock" | "shopping" | "stock-runs";

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
  const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();

  const showShopping = isCleanerModuleEnabled(settings, "shopping");
  const showStockRuns = isCleanerModuleEnabled(settings, "stockRuns");

  // Build the tab set from what's enabled — Restock is always present.
  const tabs: Array<{ key: SuppliesTab; label: string; icon: React.ReactNode }> = [
    { key: "quick-scan", label: "Quick scan", icon: <ScanLine className="h-4 w-4" /> },
    { key: "restock", label: "Restock", icon: <Package className="h-4 w-4" /> },
  ];
  if (showShopping) tabs.push({ key: "shopping", label: "Shopping", icon: <ShoppingCart className="h-4 w-4" /> });
  if (showStockRuns) tabs.push({ key: "stock-runs", label: "Stock counts", icon: <PackageSearch className="h-4 w-4" /> });

  const requested = (searchParams?.tab ?? "").toLowerCase();
  const active: SuppliesTab = tabs.some((t) => t.key === requested)
    ? (requested as SuppliesTab)
    : tabs[0].key;

  // Property list for the launchers. Quick scan needs it too — it is the FIRST
  // tab, so gating this fetch on "shopping" alone handed the default landing
  // screen an empty list and a cleaner opening Supplies saw nowhere to scan.
  const properties =
    active === "shopping" || active === "quick-scan"
      ? await db.property
          .findMany({
            where: { isActive: true },
            select: { id: true, name: true, suburb: true },
            orderBy: { name: "asc" },
          })
          .catch(() => [])
      : [];

  // Counts somebody has asked THIS person for. Shown above the tabs rather than
  // inside one, because it is an instruction from the office and not a tool they
  // chose to open — a request filed behind a tab is a request nobody sees. The
  // dashboard's "stock counts you have been asked to do" alert links straight
  // here, so this is where that promise has to be kept.
  const myScanTasks = await db.scanTask
    .findMany({
      where: { assigneeId: session.user.id, completedAt: null, cancelledAt: null },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 20,
      select: {
        id: true,
        instructions: true,
        dueAt: true,
        property: { select: { id: true, name: true, suburb: true } },
        requestedBy: { select: { name: true } },
      },
    })
    .catch(() => []);

  const description =
    active === "quick-scan"
      ? "Scan a shelf label to add, remove, set or move stock. Pick the action once, then keep scanning."
      : active === "restock"
      ? "Topped up supplies at a property? Record what you added so on-hand counts stay accurate."
      : active === "shopping"
        ? "Choose what needs buying, start the run, then track receipts, payment, and time in the run workspace."
        : "Count actual stock levels on site and submit the run for admin review.";

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Inventory" title="Supplies" description={description} />

      {myScanTasks.length > 0 ? (
        <section className="space-y-2 rounded-[var(--e-radius-lg)] border-l-[3px] border-[hsl(var(--e-info))] bg-[hsl(var(--e-info-soft))] p-4">
          <h2 className="text-[0.9375rem] font-semibold text-[hsl(var(--e-foreground))]">
            {myScanTasks.length === 1
              ? "You have been asked to count a property"
              : `You have been asked to count ${myScanTasks.length} properties`}
          </h2>
          <ul className="space-y-2">
            {myScanTasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/v2/cleaner/stock-count/${task.property.id}?task=${task.id}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface))] px-3 py-2 hover:bg-[hsl(var(--e-surface-raised))]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[0.875rem] font-medium text-[hsl(var(--e-foreground))]">
                      {[task.property.name, task.property.suburb].filter(Boolean).join(" · ")}
                    </span>
                    <span className="block truncate text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                      {task.requestedBy?.name?.trim() || "The office"} asked
                      {task.dueAt
                        ? ` · due ${new Intl.DateTimeFormat("en-AU", {
                            timeZone: "Australia/Sydney",
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          }).format(task.dueAt)}`
                        : ""}
                      {task.instructions ? ` · ${task.instructions}` : ""}
                    </span>
                  </span>
                  <ScanLine className="h-4 w-4 shrink-0 text-[hsl(var(--e-primary))]" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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

      {active === "quick-scan" ? <QuickScanLauncher properties={properties} /> : null}
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
