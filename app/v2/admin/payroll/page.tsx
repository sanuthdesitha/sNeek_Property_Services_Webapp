import { redirect } from "next/navigation";
import { financeTabRedirect } from "@/lib/admin/finance-redirects";

// Payroll is the "Pay runs" tab of Invoices and pay. /v2/admin/payroll/[id]
// (one run) is unchanged.
export default function V2AdminPayrollRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(financeTabRedirect("payroll", searchParams));
}
