import { redirect } from "next/navigation";
import { formsTabRedirect } from "@/lib/admin/forms-redirects";

// The checklist library is the "Checklist blocks" tab of the Forms library.
// /v2/admin/checklists/coverage is unchanged.
export default function EstateChecklistsRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(formsTabRedirect("blocks", searchParams));
}
