import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { PayrollRunsList } from "@/components/payroll/payroll-runs-list";

export default async function PayrollPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Payroll</h2>
        <p className="text-sm text-muted-foreground">Manage payroll runs and payouts.</p>
      </div>
      <PayrollRunsList />
    </div>
  );
}
