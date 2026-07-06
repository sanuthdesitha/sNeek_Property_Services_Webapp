import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { ShoppingRunWorkspaceEstate } from "@/components/v2/client/shopping/run-workspace";

export const metadata = { title: "Shopping run · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientShoppingRunPage({ params }: { params: { id: string } }) {
  await ensureClientModuleAccess("shopping");
  await requireRole([Role.CLIENT]);
  return (
    <ShoppingRunWorkspaceEstate
      apiBase="/api/client/inventory/shopping-runs"
      runId={params.id}
      backHref="/v2/client/shopping"
      backLabel="Back to shopping"
    />
  );
}
