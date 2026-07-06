import { redirect } from "next/navigation";

// Mirrors legacy app/admin/users: merged into the unified Accounts hub.
export const dynamic = "force-dynamic";

export default function EstateUsersRedirect() {
  redirect("/v2/admin/accounts");
}
