import { redirect } from "next/navigation";

// Preserve bookmarks now that administration tools live in the navigation.
export default function AdminSystemPage() {
  redirect("/v2/admin");
}
