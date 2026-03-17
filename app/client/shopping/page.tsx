import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { Button } from "@/components/ui/button";
import { ShoppingPlanner } from "@/components/inventory/shopping-planner";

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
      <ShoppingPlanner
        mode="client"
        apiPath="/api/client/inventory/shopping-plan"
        runsApiBase="/api/client/inventory/shopping-runs"
        initialPropertyId={searchParams?.propertyId}
        title="Start Shopping"
        description="Plan a restock run for your property inventory. Adjust quantities if you only want an emergency top-up."
      />
    </div>
  );
}
