import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { LabelManager } from "@/components/v2/admin/inventory/label-manager";

/**
 * Shelf labels: generate, select, print.
 *
 * Dynamic because it lists labels minted seconds ago — a cached page here means
 * an admin generates forty labels and prints an empty sheet.
 */
export const dynamic = "force-dynamic";

export default async function LabelsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const properties = await db.property.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-5">
      <EPageHeader
        title="Shelf labels"
        description="Print a barcode for any item, pinned to a property or general. Cleaners scan these to adjust stock."
      />
      <LabelManager properties={properties} />
    </div>
  );
}
