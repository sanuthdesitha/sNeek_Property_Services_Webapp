import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { LaundrySuppliersWorkspace } from "@/components/admin/laundry-suppliers-workspace";

export default async function AdminLaundrySuppliersPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const suppliers = await db.laundrySupplier.findMany({ orderBy: [{ name: "asc" }] });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Laundry Suppliers</h1>
          <p className="text-sm text-muted-foreground">Manage third-party laundry suppliers and the cost data shown in laundry drop-off updates.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/laundry">Back to laundry</Link>
        </Button>
      </div>
      <LaundrySuppliersWorkspace initialSuppliers={suppliers as any} />
    </div>
  );
}
