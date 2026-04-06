import { getAppSettings } from "@/lib/settings";
import { getPublishedSubscriptionPlans } from "@/lib/marketing/subscriptions";
import { SubscriptionsPage } from "@/components/public/subscriptions-page";
import { requireWebsitePageEnabled } from "@/lib/public-site/routing";

export default async function SubscriptionsPageRoute() {
  const [plans, settings] = await Promise.all([getPublishedSubscriptionPlans(), getAppSettings()]);
  requireWebsitePageEnabled(settings.websiteContent, "subscriptions");
  return <SubscriptionsPage plans={plans} content={settings.websiteContent.subscriptions} />;
}
