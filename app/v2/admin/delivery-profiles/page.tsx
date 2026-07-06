import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateDeliveryProfiles } from "@/components/v2/admin/delivery-profiles/estate-delivery-profiles";

export const metadata = { title: "Delivery profiles · Estate admin" };
export const dynamic = "force-dynamic";

// Estate-native per-client delivery preferences. Same endpoint as v1
// (/api/admin/client-delivery-profiles GET/PATCH): report/invoice recipients
// and auto-send behaviour, upserted per active client.
export default async function AdminDeliveryProfilesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Client operations"
        title="Delivery profiles"
        description="Default report and invoice recipients, plus auto-send behaviour, per client."
      />

      <EstateDeliveryProfiles />
    </div>
  );
}
