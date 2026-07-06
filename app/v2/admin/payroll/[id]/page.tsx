import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { PayrollRunDetail } from "@/components/v2/admin/finance/payroll-run-detail";

export const metadata = { title: "Payroll run · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2PayrollRunPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Payroll run"
        description="Review the period, process payouts, and manage each cleaner's payment."
      />
      <PayrollRunDetail runId={params.id} />
    </div>
  );
}
