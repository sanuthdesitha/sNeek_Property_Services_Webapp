import { redirect } from "next/navigation";

// Consolidated into the Inventory & Supplies hub. Detail routes (if any) stay
// untouched; only this list index redirects.
export default function StockRunsRedirect() {
  redirect("/admin/inventory?tab=stock-counts");
}
