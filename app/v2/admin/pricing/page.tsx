import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstatePageLock } from "@/components/v2/admin/pricing/estate-page-lock";
import { EstatePricingEditor } from "@/components/v2/admin/pricing/estate-pricing-editor";
import { PricebookSection } from "@/components/v2/admin/pricing/pricebook-section";

export const metadata = { title: "Pricing · Estate admin" };
export const dynamic = "force-dynamic";

// Estate-native rate card. Same endpoints as v1 (/api/admin/pricing/rate-card,
// /api/admin/pricing/services, /api/admin/settings). Replicates the v1 pricing
// gate: the page is locked behind an admin PIN / password re-auth
// (POST /api/admin/security/verify) before rates can be viewed or edited.
export default async function AdminPricingPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  // PATCH /api/admin/pricebook/[id] is admin-only; ops managers may only view
  // the price book (GET allows them), so the section renders read-only.
  const canEditPricebook = session.user.role === Role.ADMIN;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Commercial"
        title="Pricing"
        description="Rate card, service rates, and the margin-floor guard that protects every quote."
      />

      <EstatePageLock
        lockId="pricing"
        title="Pricing is locked"
        description="Enter your admin PIN or password to view and edit service pricing."
      >
        <div className="space-y-8">
          <EstatePricingEditor />
          <PricebookSection canEdit={canEditPricebook} />
        </div>
      </EstatePageLock>
    </div>
  );
}
