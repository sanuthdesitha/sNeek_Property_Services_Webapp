import { redirect } from "next/navigation";

// Clock Adjustments now live inside the Approval Center (Clock Adjustments tab).
export default function AdminTimeAdjustmentsRedirect() {
  redirect("/admin/approvals?tab=clock");
}
