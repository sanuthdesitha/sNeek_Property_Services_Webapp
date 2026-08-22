import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ConsolidatedShopping } from "@/components/v2/inventory/consolidated-shopping";

/**
 * What to buy, across every property.
 *
 * Dynamic: the list is derived from live stock, so a count finished five
 * minutes ago has to show here. A cached shopping list is one that sends
 * somebody out for something already on the shelf.
 */
export const dynamic = "force-dynamic";

export default async function ConsolidatedShoppingPage() {
  // Cleaners and laundry staff do the shopping, so they can open this too.
  await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.LAUNDRY]);

  return (
    <div className="space-y-5">
      <EPageHeader
        title="Shopping list"
        description="Everything below its reorder level, combined across properties."
      />
      <ConsolidatedShopping />
    </div>
  );
}
