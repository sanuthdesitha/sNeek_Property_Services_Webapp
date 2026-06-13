import { redirect } from "next/navigation";

// Invoices now live under the "Invoices" tab of the Finance hub.
export default function AdminInvoicesRedirect() {
  redirect("/admin/finance?tab=invoices");
}
