import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { QuickScanPanel } from "@/components/v2/inventory/quick-scan-panel";

/**
 * Scan-and-adjust for one property.
 *
 * Sibling of the stock count: that one reconciles the whole cupboard and zeroes
 * whatever was missed, this one touches only what you point at. Both exist
 * because they answer different questions — "what is actually here?" versus
 * "I just used two of these".
 */
export const dynamic = "force-dynamic";

export default async function QuickScanPage({ params }: { params: { propertyId: string } }) {
  await requireRole([Role.CLEANER, Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  const property = await db.property.findUnique({
    where: { id: params.propertyId },
    select: { id: true, name: true, suburb: true },
  });
  if (!property) notFound();

  // Destinations for Move mode, name-ordered and capped: someone moving a
  // bottle needs the places they actually work, not every property the business
  // has ever taken on.
  const properties = await db.property.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 200,
  });

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-4">
      <div>
        <h1 className="text-[1.125rem] font-[600]">Quick scan</h1>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {[property.name, property.suburb].filter(Boolean).join(" · ")}
        </p>
      </div>
      <QuickScanPanel propertyId={property.id} properties={properties} />
    </div>
  );
}
