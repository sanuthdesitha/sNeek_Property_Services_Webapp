import { redirect } from "next/navigation";

// Pay Requests now live inside the Approval Center (Pay Requests tab).
export default function AdminPayAdjustmentsRedirect() {
  redirect("/admin/approvals?tab=pay");
}
