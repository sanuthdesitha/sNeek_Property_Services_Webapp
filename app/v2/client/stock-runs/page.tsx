import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { StockRunWorkspace } from "@/components/inventory/stock-run-workspace";

export const metadata = { title: "Stock counts · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientStockRunsPage() {
  await ensureClientModuleAccess("stockRuns");
  await requireRole([Role.CLIENT]);
  return (
    <StockRunWorkspace
      apiBase="/api/client/stock-runs"
      title="Stock Counts"
      description="Run a full stock count for your property inventory and submit it for reconciliation."
    />
  );
}
