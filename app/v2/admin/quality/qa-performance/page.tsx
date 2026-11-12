import { redirect } from "next/navigation";
import { qualityTabRedirect } from "@/lib/quality/redirects";

// QA performance is the Inspectors tab of the Quality hub.
export default function V2AdminQaPerformanceRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  redirect(qualityTabRedirect("inspectors", searchParams));
}
