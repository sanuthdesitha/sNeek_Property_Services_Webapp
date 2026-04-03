import { DEFAULT_PUBLIC_SUBSCRIPTION_PLANS } from "@/lib/marketing/default-subscription-plans";
import { getMarketingSubscriptionPlans, type MarketingSubscriptionPlanRecord } from "@/lib/marketing/store";

export { DEFAULT_PUBLIC_SUBSCRIPTION_PLANS };

export async function getPublishedSubscriptionPlans() {
  const plans = await getMarketingSubscriptionPlans();
  return plans
    .filter((plan: MarketingSubscriptionPlanRecord) => plan.isPublished)
    .sort((a: MarketingSubscriptionPlanRecord, b: MarketingSubscriptionPlanRecord) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function getAllSubscriptionPlans() {
  return getMarketingSubscriptionPlans();
}
