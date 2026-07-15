import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { AccountabilityDashboard } from "@/components/v2/admin/quality/accountability-dashboard";

export const metadata = { title: "Accountability · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminAccountabilityPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Quality"
        title="Accountability"
        description="Per-cleaner quality accountability — scores, ratings, streaks, issues, coaching and bonus proposals."
      />
      <AccountabilityDashboard />
    </div>
  );
}
