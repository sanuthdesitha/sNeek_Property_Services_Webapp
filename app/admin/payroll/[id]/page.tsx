import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { PayrollRunDetail } from "@/components/payroll/payroll-run-detail";

export default async function PayrollRunPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Payroll Run</h2>
        <p className="text-sm text-muted-foreground">Review and process payouts.</p>
      </div>
      <PayrollRunDetail runId={params.id} />
    </div>
  );
}
