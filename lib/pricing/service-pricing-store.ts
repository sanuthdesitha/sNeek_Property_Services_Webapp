import { db } from "@/lib/db";
import { defaultServicePricing, type ServicePricingMap, type ServiceRate } from "./service-catalog";

const KEY = "servicePricing";

/** Catalog defaults merged with any admin overrides (jobType → rate). */
export async function getServicePricing(): Promise<ServicePricingMap> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  const overrides = (row?.value as ServicePricingMap | undefined) ?? {};
  const defaults = defaultServicePricing();
  const merged: ServicePricingMap = {};
  for (const [jobType, rate] of Object.entries(defaults)) {
    merged[jobType] = { ...rate, ...(overrides[jobType] ?? {}) };
  }
  return merged;
}

/** Persist the rate for a single job type. */
export async function saveServiceRate(jobType: string, rate: ServiceRate): Promise<void> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  const current = (row?.value as ServicePricingMap | undefined) ?? {};
  current[jobType] = rate;
  await db.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: current as any },
    update: { value: current as any },
  });
}
