import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { StockRunsWorkspace } from "@/components/v2/client/stockruns/stock-runs-workspace";

export const metadata = { title: "Stock counts · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientStockRunsPage() {
  await ensureClientModuleAccess("stockRuns");
  await requireRole([Role.CLIENT]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your homes"
        title="Stock counts"
        description="Run a full stock count for your property inventory and submit it for reconciliation."
      />
      <StockRunsWorkspace apiBase="/api/client/stock-runs" />
    </div>
  );
}
