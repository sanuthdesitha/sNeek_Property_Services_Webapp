import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getFinanceDashboardData } from "@/lib/finance/dashboard";
import { FinanceDashboardWorkspace } from "@/components/admin/finance-dashboard-workspace";
import { Button } from "@/components/ui/button";

export default async function AdminFinanceDashboardPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const data = await getFinanceDashboardData();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Finance Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Revenue, conversion, QA trend, and cleaner contribution in one view.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/finance">Finance overview</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/finance/payroll">Open payroll</Link>
          </Button>
        </div>
      </div>
      <FinanceDashboardWorkspace data={data} />
    </div>
  );
}
