import { redirect } from "next/navigation";

// Merged into the unified Accounts hub (staff + clients).
export default function AdminUsersRedirect() {
  redirect("/admin/accounts?tab=staff");
}
