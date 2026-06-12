import { redirect } from "next/navigation";

// Issues was merged into Cases — keep old bookmarks working.
export default function AdminIssuesRedirect() {
  redirect("/admin/cases");
}
