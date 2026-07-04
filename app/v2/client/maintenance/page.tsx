import { Role } from "@prisma/client";
import { Wrench } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getClientPortalContext } from "@/lib/client/portal";
import { filterAirbnbPropertyIds } from "@/lib/maintenance/airbnb";
import { ClientMaintenance } from "@/components/maintenance/client-maintenance";
import { EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Maintenance · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientMaintenancePage() {
  const session = await requireRole([Role.CLIENT]);
  const portal = await getClientPortalContext(session.user.id).catch(() => null);

  let airbnbProperties: { id: string; name: string; suburb: string | null }[] = [];
  if (portal?.clientId) {
    const properties = await db.property
      .findMany({
        where: { clientId: portal.clientId, isActive: true },
        select: { id: true, name: true, suburb: true },
        orderBy: { name: "asc" },
      })
      .catch(() => []);
    const airbnbIds = await filterAirbnbPropertyIds(properties.map((p) => p.id)).catch(() => new Set<string>());
    airbnbProperties = properties.filter((p) => airbnbIds.has(p.id));
  }

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your homes"
        title="Maintenance"
        description="Track items that need fixing or replacing on your Airbnb properties — reported by you or our team, worked down to resolution."
      />
      {airbnbProperties.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing here"
          title="No Airbnb properties"
          description="Maintenance tracking is available for Airbnb turnover properties. Once one is set up, you'll be able to report and track items here."
        />
      ) : (
        <ClientMaintenance properties={airbnbProperties} />
      )}
    </div>
  );
}
