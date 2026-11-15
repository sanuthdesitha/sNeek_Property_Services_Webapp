import { DenialPage } from "@/components/v2/access/denial-view";
import { loadPortalDenial } from "@/lib/access/denial-server";
import { fromSearchParam } from "@/lib/access/return-path";

export const metadata = { title: "Access" };
export const dynamic = "force-dynamic";

/** Maintenance portal: why a page refused, in this portal's look (board "Access denied"). */
export default async function MaintenanceAccessDeniedPage({ searchParams }: { searchParams?: { from?: string | string[] } }) {
  const from = fromSearchParam(searchParams?.from);
  const view = await loadPortalDenial("maintenance", from);
  return <DenialPage view={view} fromPath={from} />;
}
