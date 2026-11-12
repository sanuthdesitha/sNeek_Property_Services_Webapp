import { getAppSettings } from "@/lib/settings";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { resolvePropertyTab } from "@/lib/properties/detail-tabs";
import { PropertyDetail } from "@/components/v2/admin/properties/property-detail";

export const metadata = { title: "Property · Estate admin" };
export const dynamic = "force-dynamic";

/** The property page. `?tab=` deep links open their tab (old ids mapped: profile → Overview, inventory → Stock). */
export default async function EstatePropertyDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: { tab?: string | string[] } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const rawTab = Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab;
  return (
    <PropertyDetail
      propertyId={params.id}
      timeZone={(await getAppSettings()).timezone}
      initialTab={rawTab ? resolvePropertyTab(rawTab) : undefined}
    />
  );
}
