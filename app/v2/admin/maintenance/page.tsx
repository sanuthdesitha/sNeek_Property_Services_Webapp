import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { filterAirbnbPropertyIds } from "@/lib/maintenance/airbnb";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateMaintenanceWorkspace } from "@/components/v2/admin/maintenance/maintenance-workspace";

export const metadata = { title: "Maintenance · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateMaintenancePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  // Property filter is limited to Airbnb properties (the only ones with items).
  const properties = await db.property.findMany({
    where: { isActive: true },
    select: { id: true, name: true, suburb: true },
    orderBy: { name: "asc" },
  });
  const airbnbIds = await filterAirbnbPropertyIds(properties.map((p) => p.id));
  const airbnbProperties = properties.filter((p) => airbnbIds.has(p.id));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Maintenance tracker"
        description="Items needing repair or replacement across Airbnb properties — reported by cleaners, QA, clients, and admins. Select several to work them down in bulk."
      />
      <EstateMaintenanceWorkspace properties={airbnbProperties} />
    </div>
  );
}
