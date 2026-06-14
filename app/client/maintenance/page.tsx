import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Wrench } from "lucide-react";
import { getClientPortalContext } from "@/lib/client/portal";
import { filterAirbnbPropertyIds } from "@/lib/maintenance/airbnb";
import { ClientMaintenance } from "@/components/maintenance/client-maintenance";

export const dynamic = "force-dynamic";

export default async function ClientMaintenancePage() {
  const session = await requireRole([Role.CLIENT]);
  const portal = await getClientPortalContext(session.user.id);

  let airbnbProperties: { id: string; name: string; suburb: string | null }[] = [];
  if (portal.clientId) {
    const properties = await db.property.findMany({
      where: { clientId: portal.clientId, isActive: true },
      select: { id: true, name: true, suburb: true },
      orderBy: { name: "asc" },
    });
    const airbnbIds = await filterAirbnbPropertyIds(properties.map((p) => p.id));
    airbnbProperties = properties.filter((p) => airbnbIds.has(p.id));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        description="Track items that need fixing or replacing on your Airbnb properties — reported by you or our team, worked down to resolution."
        icon={<Wrench />}
      />
      {airbnbProperties.length === 0 ? (
        <EmptyState
          icon={<Wrench className="h-6 w-6" />}
          title="No Airbnb properties"
          body="Maintenance tracking is available for Airbnb turnover properties. Once one is set up, you'll be able to report and track items here."
        />
      ) : (
        <ClientMaintenance properties={airbnbProperties} />
      )}
    </div>
  );
}
