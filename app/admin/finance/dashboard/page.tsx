import { redirect } from "next/navigation";

// The finance analytics dashboard is now the "Overview" tab of the Finance hub.
export default function AdminFinanceDashboardRedirect() {
  redirect("/admin/finance?tab=overview");
}
