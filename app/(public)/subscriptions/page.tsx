import { getAppSettings } from "@/lib/settings";
import { getPublishedSubscriptionPlans } from "@/lib/marketing/subscriptions";
import { SubscriptionsPage } from "@/components/public/subscriptions-page";

export default async function SubscriptionsPageRoute() {
  const [plans, settings] = await Promise.all([getPublishedSubscriptionPlans(), getAppSettings()]);
  return <SubscriptionsPage plans={plans} content={settings.websiteContent.subscriptions} />;
}
