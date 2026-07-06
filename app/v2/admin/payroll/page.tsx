import { redirect } from "next/navigation";

// Mirrors the legacy behaviour: /admin/payroll is a pure redirect into the
// Finance hub's Payroll tab. The Estate equivalent lives at /v2/admin/finance.
export default function V2AdminPayrollRedirect() {
  redirect("/v2/admin/finance?tab=payroll");
}
