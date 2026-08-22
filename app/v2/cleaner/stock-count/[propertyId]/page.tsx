import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { StockCountRun } from "@/components/v2/cleaner/stock-count-run";

/**
 * The scanned stock count for one property.
 *
 * Dynamic because it opens a camera and writes stock — there is nothing worth
 * caching, and a stale property name on the one screen a cleaner uses to check
 * they are in the right cupboard would be a small lie in an expensive place.
 */
export const dynamic = "force-dynamic";

export default async function StockCountPage({ params }: { params: { propertyId: string } }) {
  // Laundry staff hold stock too, so they are not excluded here.
  await requireRole([Role.CLEANER, Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  const property = await db.property.findUnique({
    where: { id: params.propertyId },
    select: { id: true, name: true, suburb: true },
  });
  if (!property) notFound();

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-4">
      <StockCountRun
        propertyId={property.id}
        propertyName={[property.name, property.suburb].filter(Boolean).join(" · ")}
      />
    </div>
  );
}
