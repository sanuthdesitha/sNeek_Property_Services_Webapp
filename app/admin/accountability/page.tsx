import { redirect } from "next/navigation";
import { qualityTabRedirect } from "@/lib/quality/redirects";

/**
 * Old notification emails linked to /admin/accountability, a page that no
 * longer exists (parity audit 2026-11-12). Accountability is the Quality hub's
 * Cleaners tab; query parameters (cleanerId, category, ...) are kept. The hub
 * page applies its own role and pack guards.
 */
export default function AdminAccountabilityRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(qualityTabRedirect("cleaners", searchParams));
}
