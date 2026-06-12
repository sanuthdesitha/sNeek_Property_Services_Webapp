import Link from "next/link";
import { Role } from "@prisma/client";
import { Truck } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { LaundrySuppliersWorkspace } from "@/components/admin/laundry-suppliers-workspace";

export default async function AdminLaundrySuppliersPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const suppliers = await db.laundrySupplier.findMany({ orderBy: [{ name: "asc" }] });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Truck />}
        title="Laundry Suppliers"
        description="Manage third-party laundry suppliers and the cost data shown in laundry drop-off updates."
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/laundry">Back to laundry</Link>
          </Button>
        }
      />
      <LaundrySuppliersWorkspace initialSuppliers={suppliers as any} />
    </div>
  );
}
