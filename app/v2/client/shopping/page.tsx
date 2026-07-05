import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { EButton, EEyebrow, EPageHeader } from "@/components/v2/ui/primitives";
import { ShoppingLauncher } from "@/components/v2/client/shopping/shopping-launcher";
import { PurchasesFeed } from "@/components/v2/client/shopping/purchases-feed";

export const metadata = { title: "Shopping · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientShoppingPage({
  searchParams,
}: {
  searchParams?: { propertyId?: string };
}) {
  await ensureClientModuleAccess("shopping");
  await requireRole([Role.CLIENT]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your homes"
        title="Shopping"
        description="Choose what needs buying, start the run, then track receipts and payment inside the run workspace."
        actions={
          <EButton asChild variant="outline" size="sm">
            <Link href="/v2/client/inventory">Back to inventory</Link>
          </EButton>
        }
      />

      <ShoppingLauncher
        apiPath="/api/client/inventory/shopping-plan"
        runsApiBase="/api/client/inventory/shopping-runs"
        workspaceBasePath="/v2/client/shopping"
        initialPropertyId={searchParams?.propertyId}
      />

      <section className="space-y-3">
        <div>
          <EEyebrow>Purchase history</EEyebrow>
          <h2 className="e-display-sm mt-1">Purchases for your properties</h2>
          <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Everything bought for your units — including by our team — with receipts and how each was paid.
          </p>
        </div>
        <PurchasesFeed />
      </section>
    </div>
  );
}
