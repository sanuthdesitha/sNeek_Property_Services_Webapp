import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { StockRunWorkspace } from "@/components/inventory/stock-run-workspace";

export default async function CleanerStockRunsPage() {
  await ensureCleanerModuleAccess("stockRuns");
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <StockRunWorkspace
      apiBase="/api/cleaner/stock-runs"
      title="Stock Counts"
      description="Count actual stock levels on site and submit the run for admin review."
    />
  );
}
