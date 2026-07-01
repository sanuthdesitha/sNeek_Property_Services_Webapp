import { redirect } from "next/navigation";

// Email & SMS templates now live under Notifications (Email & SMS templates tab).
export default function EmailTemplatesRedirect() {
  redirect("/admin/notifications?tab=templates");
}
