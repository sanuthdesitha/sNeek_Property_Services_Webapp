import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { RestockPanel } from "@/components/v2/cleaner/restock-panel";

export const metadata = { title: "Restock · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Estate cleaner restock workspace. Same auth as the legacy
 * `app/cleaner/restock` route. The mounted Estate-native `RestockPanel` owns its
 * live restock data + submit mutations against /api/cleaner/inventory/restock.
 */
export default async function V2CleanerRestockPage() {
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Inventory"
        title="Restock"
        description="Topped up supplies at a property? Record what you added so on-hand counts stay accurate."
      />
      <RestockPanel />
    </div>
  );
}
