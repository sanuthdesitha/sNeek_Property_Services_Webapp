import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureCleanerModuleAccess } from "@/lib/portal-access";
import { Button } from "@/components/ui/button";
import { ShoppingPlanner } from "@/components/inventory/shopping-planner";

export default async function CleanerShoppingPage({
  searchParams,
}: {
  searchParams?: { propertyId?: string };
}) {
  await ensureCleanerModuleAccess("shopping");
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/cleaner">Back to Dashboard</Link>
        </Button>
      </div>
      <ShoppingPlanner
        mode="cleaner"
        apiPath="/api/cleaner/inventory/shopping-plan"
        runsApiBase="/api/cleaner/inventory/shopping-runs"
        initialPropertyId={searchParams?.propertyId}
        title="Shopping Run Planner"
        description="Review low-stock items across properties, combine items, and prioritize emergency top-ups when space is limited."
      />
    </div>
  );
}
