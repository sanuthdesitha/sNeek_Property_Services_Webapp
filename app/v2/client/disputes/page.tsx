import { redirect } from "next/navigation";
import { withQuery, type RouteSearchParams } from "@/lib/navigation/redirect-query";

export const dynamic = "force-dynamic";

// Legacy `/client/disputes` redirects to `/client/cases`; disputes are handled
// inside the unified cases workspace. Mirror that behaviour for the Estate route.
export default async function V2ClientDisputesRoute({ searchParams }: { searchParams?: RouteSearchParams }) {
  redirect(withQuery("/v2/client/cases", searchParams));
}
