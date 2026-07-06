import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { ShoppingRunWorkspace } from "@/components/v2/cleaner/shopping-run-workspace";

export const metadata = { title: "Shopping run · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Estate wrapper for an active shopping run. Same module gate as the legacy
 * `app/cleaner/shopping/[id]` route. The monolithic `ShoppingRunWorkspace`
 * client owns the full run executor (receipts, payment, time, line items) and
 * hits the same cleaner shopping-runs endpoints; the workspace itself scopes the
 * run to the session cleaner. `backHref` returns into this Estate shell.
 */
export default async function V2CleanerShoppingRunPage({ params }: { params: { id: string } }) {
  await ensureCleanerModuleAccess("shopping");
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <ShoppingRunWorkspace
        apiBase="/api/cleaner/inventory/shopping-runs"
        runId={params.id}
        backHref="/v2/cleaner/shopping"
        backLabel="Back to shopping"
        title="Active Shopping Run"
      />
    </div>
  );
}
