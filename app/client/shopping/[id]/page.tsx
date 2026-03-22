import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { ShoppingRunWorkspace } from "@/components/inventory/shopping-run-workspace";

export default async function ClientShoppingRunPage({ params }: { params: { id: string } }) {
  await ensureClientModuleAccess("shopping");
  await requireRole([Role.CLIENT]);
  return (
    <ShoppingRunWorkspace
      apiBase="/api/client/inventory/shopping-runs"
      runId={params.id}
      backHref="/client/shopping"
      backLabel="Back to shopping"
      title="Active Shopping Run"
    />
  );
}

