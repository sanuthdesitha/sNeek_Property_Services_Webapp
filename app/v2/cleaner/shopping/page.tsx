import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Shopping now lives as a tab inside the merged Supplies hub. The run-detail
// route (shopping/[id]) is unaffected — started runs still open there. A deep
// link carrying ?propertyId is preserved so the launcher pre-selects it.
export default function V2CleanerShoppingRedirect({
  searchParams,
}: {
  searchParams?: { propertyId?: string };
}) {
  const propertyId = searchParams?.propertyId;
  redirect(
    propertyId
      ? `/v2/cleaner/supplies?tab=shopping&propertyId=${encodeURIComponent(propertyId)}`
      : "/v2/cleaner/supplies?tab=shopping"
  );
}
