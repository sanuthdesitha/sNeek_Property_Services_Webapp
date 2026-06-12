import Link from "next/link";
import { Role } from "@prisma/client";
import { BarChart3 } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { getFinanceDashboardData } from "@/lib/finance/dashboard";
import { FinanceDashboardWorkspace } from "@/components/admin/finance-dashboard-workspace";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export default async function AdminFinanceDashboardPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const data = await getFinanceDashboardData();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<BarChart3 />}
        title="Finance Analytics"
        description="Revenue, conversion, QA trend, and cleaner contribution in one view."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/admin/finance">Finance overview</Link>
            </Button>
            <Button asChild>
              <Link href="/admin/finance/payroll">Open payroll</Link>
            </Button>
          </>
        }
      />
      <FinanceDashboardWorkspace data={data} />
    </div>
  );
}
