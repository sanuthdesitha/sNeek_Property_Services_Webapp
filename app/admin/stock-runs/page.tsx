import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { StockRunWorkspace } from "@/components/inventory/stock-run-workspace";

export default async function AdminStockRunsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <StockRunWorkspace
      apiBase="/api/admin/stock-runs"
      title="Stock Counts"
      description="Run full inventory counts, review counted stock, and apply the adjustments back to property inventory."
    />
  );
}
