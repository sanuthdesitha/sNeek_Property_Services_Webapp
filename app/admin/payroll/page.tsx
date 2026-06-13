import { redirect } from "next/navigation";

// Payroll runs now live under the "Payroll" tab of the Finance hub. The
// per-run detail route (/admin/payroll/[id]) is unaffected.
export default function AdminPayrollRedirect() {
  redirect("/admin/finance?tab=payroll");
}
