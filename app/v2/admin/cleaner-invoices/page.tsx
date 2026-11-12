import { redirect } from "next/navigation";
import { financeTabRedirect } from "@/lib/admin/finance-redirects";

export const dynamic = "force-dynamic";

// Cleaner invoices is a tab of Invoices and pay; the page there re-checks the
// viewer's role and operations-manager pack before rendering it.
export default function CleanerInvoicesRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(financeTabRedirect("cleaner-invoices", searchParams));
}
