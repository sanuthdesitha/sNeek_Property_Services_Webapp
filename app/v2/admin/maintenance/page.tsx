import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { filterAirbnbPropertyIds } from "@/lib/maintenance/airbnb";
import { MaintenanceHub } from "@/components/v2/admin/maintenance/maintenance-hub";
import { readMaintenanceView } from "@/components/v2/admin/maintenance/maintenance-view";

export const metadata = { title: "Maintenance · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Maintenance (board "Maintenance", 2026-11-14): Items and People and trades.
 * Admin / ops only, as before. Maintenance stays Airbnb-only: the property
 * filter and "Report an item" offer Airbnb properties, and the report endpoint
 * refuses anything else.
 */
export default async function EstateMaintenancePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") query.set(key, first);
  }

  const [properties, settings] = await Promise.all([
    db.property.findMany({
      where: { isActive: true },
      select: { id: true, name: true, suburb: true },
      orderBy: { name: "asc" },
    }),
    getAppSettings().catch(() => null),
  ]);
  const airbnbIds = await filterAirbnbPropertyIds(properties.map((p) => p.id));
  const airbnbProperties = properties.filter((p) => airbnbIds.has(p.id));

  return (
    <MaintenanceHub
      initialView={readMaintenanceView(`?${query.toString()}`)}
      properties={airbnbProperties}
      isAdmin={session.user.role === Role.ADMIN}
      timeZone={settings?.timezone || "Australia/Sydney"}
    />
  );
}
