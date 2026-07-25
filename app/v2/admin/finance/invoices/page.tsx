import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * This route used to render a read-only Estate preview table that shadowed the
 * working invoices surface. The full invoice workflow (approve, send, record
 * payment, mark as paid, Xero) lives in the finance hub's Invoices tab.
 */
export default function AdminInvoicesPage() {
  redirect("/v2/admin/finance?tab=invoices");
}
