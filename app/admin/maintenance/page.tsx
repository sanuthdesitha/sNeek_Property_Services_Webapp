import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Wrench } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { filterAirbnbPropertyIds } from "@/lib/maintenance/airbnb";
import { AdminMaintenanceWorkspace } from "@/components/maintenance/admin-maintenance-workspace";

export const dynamic = "force-dynamic";

export default async function AdminMaintenancePage() {
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
      <PageHeader
        title="Maintenance tracker"
        description="Items needing repair or replacement across Airbnb properties — reported by cleaners, QA, clients, and admins. Select several to work them down in bulk."
        icon={<Wrench />}
      />
      <AdminMaintenanceWorkspace properties={airbnbProperties} />
    </div>
  );
}
