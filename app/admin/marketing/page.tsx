import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { MarketingConsole } from "@/components/admin/marketing-console";
import { getMarketingCampaigns, getMarketingSubscriptionPlans } from "@/lib/marketing/store";

export default async function AdminMarketingPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [campaigns, plans] = await Promise.all([getMarketingCampaigns(), getMarketingSubscriptionPlans()]);

  return (
    <MarketingConsole
      initialCampaigns={campaigns}
      initialPlans={plans}
    />
  );
}
