import { redirect } from "next/navigation";
import { legacyNewFormRedirect } from "@/lib/admin/legacy-forms-redirects";

export const dynamic = "force-dynamic";

/** New forms are created at /v2/admin/forms/new (the layout still admits ADMIN only). */
export default function LegacyNewFormRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(legacyNewFormRedirect(searchParams));
}
