import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { ShoppingRunWorkspace } from "@/components/inventory/shopping-run-workspace";

export default async function CleanerShoppingRunPage({ params }: { params: { id: string } }) {
  await ensureCleanerModuleAccess("shopping");
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <ShoppingRunWorkspace
      apiBase="/api/cleaner/inventory/shopping-runs"
      runId={params.id}
      backHref="/cleaner/shopping"
      backLabel="Back to shopping"
      title="Active Shopping Run"
    />
  );
}

