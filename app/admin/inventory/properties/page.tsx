import { redirect } from "next/navigation";

// Consolidated into the Inventory & Supplies hub. Preserves bookmarks/links,
// forwarding any existing `filter` query param into the hub's "By Property" tab.
export default function PropertyInventoryRedirect({
  searchParams,
}: {
  searchParams?: { filter?: string };
}) {
  const filter = searchParams?.filter;
  const suffix = filter ? `&filter=${encodeURIComponent(filter)}` : "";
  redirect(`/admin/inventory?tab=properties${suffix}`);
}
