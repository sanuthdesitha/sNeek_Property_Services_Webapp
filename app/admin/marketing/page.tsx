import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import Link from "next/link";
import { MarketingConsole } from "@/components/admin/marketing-console";
import { getMarketingCampaigns, getMarketingSubscriptionPlans } from "@/lib/marketing/store";
import { Button } from "@/components/ui/button";

export default async function AdminMarketingPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [campaigns, plans] = await Promise.all([getMarketingCampaigns(), getMarketingSubscriptionPlans()]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href="/admin/marketing/campaigns">Open email campaigns</Link>
        </Button>
      </div>
      <MarketingConsole
        initialCampaigns={campaigns}
        initialPlans={plans}
      />
    </div>
  );
}
