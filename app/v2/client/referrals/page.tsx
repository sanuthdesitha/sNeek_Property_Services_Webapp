import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { RewardsPage } from "@/components/client/rewards-page";

export const metadata = { title: "Referrals · Estate client" };
export const dynamic = "force-dynamic";

export default async function V2ClientReferralsRoute() {
  await requireRole([Role.CLIENT]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Account"
        title="Referrals & rewards"
        description="Share your referral link and track the rewards you've earned."
      />
      <RewardsPage />
    </div>
  );
}
