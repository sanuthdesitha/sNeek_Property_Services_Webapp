import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { VisitWorkspace } from "@/components/v2/maintenance/visit-workspace";

export const metadata = { title: "Visit · Estate maintenance" };
export const dynamic = "force-dynamic";

// Native Estate maintenance on-site visit workspace. The server load gates access
// and paints the header shell; the workspace client re-fetches the full record
// from GET /api/maintenance/[id] (same contract v1 used) and drives the on-site
// flow: start/complete visit, GPS pings, before/after photos, notes, resolve.
export default async function MaintenanceVisitPage({ params }: { params: { id: string } }) {
  await requireRole([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);

  const item = await db.propertyMaintenanceItem
    .findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        property: { select: { name: true, suburb: true, address: true } },
      },
    })
    .catch(() => null);

  if (!item) notFound();

  return (
    <VisitWorkspace
      itemId={item.id}
      initialTitle={item.title}
      initialPropertyName={item.property?.name ?? null}
      initialSuburb={item.property?.suburb ?? null}
      initialAddress={item.property?.address ?? null}
    />
  );
}
