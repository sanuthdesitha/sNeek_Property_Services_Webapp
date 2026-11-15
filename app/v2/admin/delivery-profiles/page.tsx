import { Suspense } from "react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { DeliveryProfilesScreen } from "@/components/v2/admin/delivery-profiles/delivery-profiles-screen";

export const metadata = { title: "Delivery profiles · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Who receives each client's job reports and invoices by email (board
 * "Delivery profiles", 2026-11-16). ADMIN and OPS_MANAGER as before; the
 * communications pack is checked by middleware and every route re-checks the
 * role. `?client=<id>` opens a client's panel (the invoice Send dialog's
 * "Change recipients" link uses it).
 */
export default async function AdminDeliveryProfilesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <Suspense fallback={null}>
      <DeliveryProfilesScreen />
    </Suspense>
  );
}
