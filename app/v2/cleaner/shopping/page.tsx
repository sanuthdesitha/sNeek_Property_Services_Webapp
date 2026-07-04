import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ShoppingRunLauncher } from "@/components/inventory/shopping-run-launcher";
import { CleanerOnHandView } from "@/components/inventory/cleaner-on-hand-view";

export const metadata = { title: "Shopping · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Estate wrapper for the cleaner shopping launcher + on-hand view. Same module
 * gate + property query as the legacy `app/cleaner/shopping` route. The live
 * `ShoppingRunLauncher` hits the exact same cleaner shopping-plan/runs endpoints;
 * `workspaceBasePath` points at the Estate run detail so a started run opens in
 * this shell. `CleanerOnHandView` owns its own deliver-to-unit mutation.
 */
export default async function V2CleanerShoppingPage({
  searchParams,
}: {
  searchParams?: { propertyId?: string };
}) {
  await ensureCleanerModuleAccess("shopping");
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);

  const properties = await db.property
    .findMany({
      where: { isActive: true },
      select: { id: true, name: true, suburb: true },
      orderBy: { name: "asc" },
    })
    .catch(() => []);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Inventory"
        title="Shopping"
        description="Choose what needs buying, start the run, then track receipts, payment, and time in the run workspace."
      />

      <ShoppingRunLauncher
        mode="cleaner"
        apiPath="/api/cleaner/inventory/shopping-plan"
        runsApiBase="/api/cleaner/inventory/shopping-runs"
        workspaceBasePath="/v2/cleaner/shopping"
        initialPropertyId={searchParams?.propertyId}
        title="Shopping"
        description="Choose what needs to be bought, start the run, then track receipts, payment method, and shopping time inside the run workspace."
      />

      <section className="space-y-3">
        <div>
          <h2 className="e-display-sm">Your on-hand stock</h2>
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Stock you&apos;re holding that hasn&apos;t been dropped at a unit yet. Deliver it to update that unit&apos;s count.
          </p>
        </div>
        <CleanerOnHandView properties={properties} />
      </section>
    </div>
  );
}
