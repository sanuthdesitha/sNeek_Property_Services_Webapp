import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import {
  PropertiesPortfolio,
  type EstatePropertyRow,
} from "@/components/v2/admin/properties/properties-portfolio";

export const metadata = { title: "Properties · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstatePropertiesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  // Same query as the v1 properties page.
  const properties = await db.property.findMany({
    where: { isActive: true },
    include: {
      client: { select: { name: true } },
      integration: { select: { isEnabled: true, icalUrl: true, syncStatus: true } },
      _count: { select: { jobs: true } },
    },
    orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
  });

  const rows: EstatePropertyRow[] = properties.map((p) => ({
    id: p.id,
    name: p.name,
    suburb: p.suburb,
    address: p.address,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    imageUrl: p.imageUrl ?? null,
    clientName: p.client?.name ?? "Unknown client",
    jobCount: p._count.jobs,
    hasIcal: Boolean(p.integration?.isEnabled && p.integration.icalUrl),
    icalSyncStatus: p.integration?.syncStatus ? String(p.integration.syncStatus) : null,
    hasCoords: p.latitude !== null && p.longitude !== null,
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Portfolio"
        title="Properties"
        description={`${properties.length} active properties`}
        actions={
          <EButton asChild variant="gold" size="sm">
            <Link href="/v2/admin/properties/new">
              <Plus className="mr-1 h-3.5 w-3.5" /> Add property
            </Link>
          </EButton>
        }
      />

      <PropertiesPortfolio rows={rows} />
    </div>
  );
}
