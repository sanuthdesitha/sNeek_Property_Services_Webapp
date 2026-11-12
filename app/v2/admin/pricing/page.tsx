import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Pricing moved into Quotes and pricing (2026-11 redesign). The rate card is
// still behind the same PIN lock there; the price book keeps its own tab.
export default async function AdminPricingPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  redirect("/v2/admin/quotes?tab=rate-card");
}
