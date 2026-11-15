import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { canActAs } from "@/lib/auth/roles";
import { loadPayrollRunView } from "@/lib/payroll/run-view";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { PayrollRunPage } from "@/components/v2/admin/finance/payroll-run/payroll-run-page";

export const metadata = { title: "Pay run · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * One pay run (board "Pay run", 2026-11-17). Read on the server; a run that
 * cannot be read shows the heading and the reason, never $0.00 tiles. Who may
 * do what is decided by the routes; the page only offers what they allow.
 */
export default async function V2PayrollRunPage({ params }: { params: { id: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const loaded = await loadPayrollRunView(params.id);
  if (!loaded.ok && loaded.reason === "not-found") notFound();
  if (!loaded.ok) {
    return (
      <div className="space-y-4">
        <EPageHeader title="Pay run" />
        <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-danger))]">This pay run could not be loaded. {loaded.message}</p>
      </div>
    );
  }
  const held = (session.user.heldRoles ?? [session.user.role]) as Role[];
  const role = canActAs(held, [Role.ADMIN]) ? "ADMIN" : String(session.user.role);
  return <PayrollRunPage key={loaded.view.id} run={loaded.view} role={role} />;
}
