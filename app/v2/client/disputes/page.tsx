import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Legacy `/client/disputes` redirects to `/client/cases`; disputes are handled
// inside the unified cases workspace. Mirror that behaviour for the Estate route.
export default async function V2ClientDisputesRoute() {
  redirect("/v2/client/cases");
}
