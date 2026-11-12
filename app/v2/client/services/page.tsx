import { redirect } from "next/navigation";
import { withQuery, type RouteSearchParams } from "@/lib/navigation/redirect-query";

/**
 * "Services" was the jobs list under a second name — same query
 * (listClientJobsForUser), same rows, a separate set of filters to keep in
 * step, and two places for a client to look for one thing. It is retired in
 * favour of /v2/client/jobs.
 *
 * Kept as a redirect rather than deleted so existing bookmarks, emailed links
 * and any lingering references land on the jobs list instead of a 404.
 */
export default function ClientServicesRedirect({ searchParams }: { searchParams?: RouteSearchParams }) {
  // The query string survives, so a bookmarked filter still applies.
  redirect(withQuery("/v2/client/jobs", searchParams));
}
