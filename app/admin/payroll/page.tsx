import { Role } from "@prisma/client";
import { Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { PayrollRunsList } from "@/components/payroll/payroll-runs-list";
import { PageHeader } from "@/components/ui/page-header";

export default async function PayrollPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Wallet />}
        title="Payroll"
        description="Manage payroll runs and payouts."
      />
      <PayrollRunsList />
    </div>
  );
}
