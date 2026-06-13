import { redirect } from "next/navigation";

// Merged into the unified Accounts hub (staff + clients).
export default function AdminClientsRedirect() {
  redirect("/admin/accounts?tab=clients");
}
