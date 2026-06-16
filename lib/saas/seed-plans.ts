import { db } from "@/lib/db";
import { PLANS } from "@/lib/saas/plans";

/**
 * Idempotently sync the Plan table from the code-defined catalog (lib/saas/plans.ts).
 * Safe to run repeatedly — used at deploy/seed time and reusable by the platform
 * admin console later. Stripe price ids are left untouched if already set.
 */
export async function seedPlans() {
  for (const plan of Object.values(PLANS)) {
    await db.plan.upsert({
      where: { key: plan.key },
      update: {
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        currency: plan.currency,
        interval: plan.interval,
        trialDays: plan.trialDays,
        sortOrder: plan.sortOrder,
        featureFlags: plan.entitlements as unknown as object,
        isActive: true,
      },
      create: {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        currency: plan.currency,
        interval: plan.interval,
        trialDays: plan.trialDays,
        sortOrder: plan.sortOrder,
        featureFlags: plan.entitlements as unknown as object,
        isActive: true,
      },
    });
  }
}
