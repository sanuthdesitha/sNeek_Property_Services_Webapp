import { redirect } from "next/navigation";

// Consolidated into the Inventory & Supplies hub.
export default function DeliveryProfilesRedirect() {
  redirect("/admin/inventory?tab=delivery");
}
