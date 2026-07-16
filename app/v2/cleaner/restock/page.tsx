import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Restock now lives as a tab inside the merged Supplies hub.
export default function V2CleanerRestockRedirect() {
  redirect("/v2/cleaner/supplies?tab=restock");
}
