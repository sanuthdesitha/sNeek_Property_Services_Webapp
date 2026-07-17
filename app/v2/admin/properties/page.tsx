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

// Mirrors FALLBACK_CLIENT_NAME in lib/jobs/service-site.ts.

export default async function EstatePropertiesPage({
  searchParams,
}: {
  searchParams?: { includeOneOff?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  // One-off / service-site properties are hidden by default (they only carry an
  // ad-hoc job address). "Show one-off sites" (?includeOneOff=1) reveals them.
  const includeOneOff = searchParams?.includeOneOff === "1";

  const allProperties = await db.property.findMany({
    where: { isActive: true },
    include: {
      client: { select: { name: true } },
      integration: { select: { isEnabled: true, icalUrl: true, syncStatus: true } },
      _count: { select: { jobs: true } },
    },
    orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
  });

  // Hide genuine one-off / service-site properties by default. Filter in JS on
  // the precise `accessInfo.serviceSite === true` flag — a DB `NOT { serviceSite
  // = true }` drops every property with a null accessInfo (SQL NOT(unknown) =
  // unknown), which hid all real properties. Client-name is not a signal.
  const properties = includeOneOff
    ? allProperties
    : allProperties.filter((p) => (p.accessInfo as { serviceSite?: unknown } | null)?.serviceSite !== true);

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
          <div className="flex items-center gap-2">
            <EButton asChild variant="outline" size="sm">
              <Link href={includeOneOff ? "/v2/admin/properties" : "/v2/admin/properties?includeOneOff=1"}>
                {includeOneOff ? "Hide one-off sites" : "Show one-off sites"}
              </Link>
            </EButton>
            <EButton asChild variant="gold" size="sm">
              <Link href="/v2/admin/properties/new">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add property
              </Link>
            </EButton>
          </div>
        }
      />

      <PropertiesPortfolio rows={rows} />
    </div>
  );
}
