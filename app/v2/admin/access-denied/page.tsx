import { DenialPage } from "@/components/v2/access/denial-view";
import { loadOfficeDenial } from "@/lib/access/denial-server";
import { fromSearchParam } from "@/lib/access/return-path";

export const metadata = { title: "Access · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Why an office page refused (board "Access denied"): an area turned off in
 * the person's access (`reason` absent), an administrators-only page
 * (`?reason=role`) or a page of another portal (`?reason=portal`). `from` is
 * the refused page, validated as a same-origin path and only named here.
 * While testing as someone, it shows their answer.
 */
export default async function AccessDeniedPage({ searchParams }: { searchParams?: { reason?: string | string[]; from?: string | string[] } }) {
  const from = fromSearchParam(searchParams?.from);
  const reason = typeof searchParams?.reason === "string" ? searchParams.reason : undefined;
  const view = await loadOfficeDenial({ reason, from });
  return <DenialPage view={view} fromPath={from} />;
}
