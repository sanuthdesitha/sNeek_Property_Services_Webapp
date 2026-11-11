import { redirect } from "next/navigation";
import { qualityTabRedirect } from "@/lib/quality/redirects";

// Accountability is the Cleaners tab of the Quality hub. Laundry team metrics
// moved to /v2/admin/laundry/stats.
export default function V2AdminAccountabilityRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(qualityTabRedirect("cleaners", searchParams));
}
