import { redirect } from "next/navigation";

/**
 * "Services" was the jobs list under a second name — same query
 * (listClientJobsForUser), same rows, a separate set of filters to keep in
 * step, and two places for a client to look for one thing. It is retired in
 * favour of /v2/client/jobs.
 *
 * Kept as a redirect rather than deleted so existing bookmarks, emailed links
 * and any lingering references land on the jobs list instead of a 404.
 */
export default function ClientServicesRedirect() {
  redirect("/v2/client/jobs");
}
