import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { Button } from "@/components/ui/button";
import { ShoppingRunLauncher } from "@/components/inventory/shopping-run-launcher";
import { ClientPurchasesFeed } from "@/components/inventory/client-purchases-feed";

export default async function ClientShoppingPage({
  searchParams,
}: {
  searchParams?: { propertyId?: string };
}) {
  await ensureClientModuleAccess("shopping");
  await requireRole([Role.CLIENT]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/client/inventory">Back to Inventory</Link>
        </Button>
      </div>
      <ShoppingRunLauncher
        mode="client"
        apiPath="/api/client/inventory/shopping-plan"
        runsApiBase="/api/client/inventory/shopping-runs"
        workspaceBasePath="/client/shopping"
        initialPropertyId={searchParams?.propertyId}
        title="Shopping"
        description="Choose what needs to be purchased, start the run, then track receipts and payment details inside the run workspace."
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Purchases for your properties</h2>
          <p className="text-sm text-muted-foreground">
            Everything bought for your units — including by our team — with receipts and how each was paid.
          </p>
        </div>
        <ClientPurchasesFeed />
      </section>
    </div>
  );
}
