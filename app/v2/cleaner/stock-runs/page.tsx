import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Stock counts now live as a tab inside the merged Supplies hub.
export default function V2CleanerStockRunsRedirect() {
  redirect("/v2/cleaner/supplies?tab=stock-runs");
}
