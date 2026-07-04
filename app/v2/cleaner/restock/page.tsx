import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { CleanerRestockClient } from "@/components/cleaner/restock-client";

export const metadata = { title: "Restock · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Estate wrapper for the cleaner restock workspace. Same auth as the legacy
 * `app/cleaner/restock` route. The mounted `CleanerRestockClient` owns its live
 * restock request data + submit mutations via its own endpoints.
 */
export default async function V2CleanerRestockPage() {
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Inventory"
        title="Restock"
        description="Flag what needs replenishing so the office can top up unit supplies."
      />
      <CleanerRestockClient />
    </div>
  );
}
