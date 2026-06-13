import { redirect } from "next/navigation";

// Consolidated into the Inventory & Supplies hub.
export default function SuppliersRedirect() {
  redirect("/admin/inventory?tab=suppliers");
}
