import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { StockRunWorkspace } from "@/components/inventory/stock-run-workspace";

export const metadata = { title: "Stock counts · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Estate wrapper for on-site stock counts. Same module gate as the legacy
 * `app/cleaner/stock-runs` route. The monolithic `StockRunWorkspace` client owns
 * the full count/submit flow and hits the same cleaner stock-runs endpoints.
 */
export default async function V2CleanerStockRunsPage() {
  await ensureCleanerModuleAccess("stockRuns");
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Inventory"
        title="Stock counts"
        description="Count actual stock levels on site and submit the run for admin review."
      />
      <StockRunWorkspace
        apiBase="/api/cleaner/stock-runs"
        title="Stock Counts"
        description="Count actual stock levels on site and submit the run for admin review."
      />
    </div>
  );
}
