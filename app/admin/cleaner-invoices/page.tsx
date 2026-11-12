import { redirect } from "next/navigation";
import { financeTabRedirect } from "@/lib/admin/finance-redirects";

export const dynamic = "force-dynamic";

/**
 * The classic cleaner-invoice screen had no Approve step, so Submitted invoices
 * could no longer be pushed to Xero or paid from it (an existing problem, fixed
 * 2026-11-11). It now lands on the Cleaner invoices tab of Invoices and pay,
 * keeping its query. Same roles (ADMIN, OPS_MANAGER) and the same payroll pack
 * as this page; the tab re-checks both before rendering.
 */
export default function AdminCleanerInvoicesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(financeTabRedirect("cleaner-invoices", searchParams));
}
