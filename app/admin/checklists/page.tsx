import { redirect } from "next/navigation";

// Checklist editing now lives inside the Forms page (Checklists tab).
export default function AdminChecklistsRedirect() {
  redirect("/admin/forms?tab=checklists");
}
