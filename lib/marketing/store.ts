import { db } from "@/lib/db";
import { DEFAULT_PUBLIC_SUBSCRIPTION_PLANS } from "@/lib/marketing/default-subscription-plans";
import { MARKETED_JOB_TYPE_VALUES, type MarketedJobTypeValue } from "@/lib/marketing/job-types";

const CAMPAIGNS_KEY = "marketing_discount_campaigns_v1";
const PLANS_KEY = "marketing_subscription_plans_v1";

export type MarketingCampaignRecord = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  minSubtotal: number | null;
  jobTypes: MarketedJobTypeValue[] | null;
  usageLimit: number | null;
  usageCount: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MarketingSubscriptionPlanRecord = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  serviceTypes: MarketedJobTypeValue[] | null;
  cadenceOptions: string[] | null;
  startingPrice: number | null;
  priceLabel: string | null;
  features: string[] | null;
  themeKey: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_CAMPAIGNS: MarketingCampaignRecord[] = [
  {
    id: "welcome-10",
    code: "WELCOME10",
    title: "Welcome Offer",
    description: "10% off selected standard services for first-time customers.",
    discountType: "PERCENT",
    discountValue: 10,
    minSubtotal: 120,
    jobTypes: ["GENERAL_CLEAN", "DEEP_CLEAN", "AIRBNB_TURNOVER"],
    usageLimit: null,
    usageCount: 0,
    startsAt: null,
    endsAt: null,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function hasDatabaseUrl() {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0;
}

function sanitizeJobTypes(value: unknown): MarketedJobTypeValue[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.filter((item): item is MarketedJobTypeValue => typeof item === "string" && (MARKETED_JOB_TYPE_VALUES as readonly string[]).includes(item));
  return rows.length > 0 ? rows : null;
}

function sanitizeStringList(value: unknown, max = 20, itemMax = 160) {
  if (!Array.isArray(value)) return null;
  const rows = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, max).map((item) => item.slice(0, itemMax));
  return rows.length > 0 ? rows : null;
}

function sanitizeCampaigns(value: unknown): MarketingCampaignRecord[] {
  if (!Array.isArray(value)) return DEFAULT_CAMPAIGNS;
  const rows: MarketingCampaignRecord[] = value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row, index) => ({
      id: typeof row.id === "string" && row.id ? row.id : `campaign-${index + 1}`,
      code: typeof row.code === "string" ? row.code.trim().toUpperCase() : "",
      title: typeof row.title === "string" ? row.title.trim() : "",
      description: typeof row.description === "string" ? row.description.trim() : null,
      discountType: row.discountType === "FIXED" ? "FIXED" : "PERCENT",
      discountValue: Number(row.discountValue ?? 0),
      minSubtotal: row.minSubtotal == null ? null : Number(row.minSubtotal),
      jobTypes: sanitizeJobTypes(row.jobTypes),
      usageLimit: row.usageLimit == null ? null : Number(row.usageLimit),
      usageCount: Number(row.usageCount ?? 0),
      startsAt: typeof row.startsAt === "string" && row.startsAt ? row.startsAt : null,
      endsAt: typeof row.endsAt === "string" && row.endsAt ? row.endsAt : null,
      isActive: row.isActive !== false,
      createdAt: typeof row.createdAt === "string" && row.createdAt ? row.createdAt : new Date().toISOString(),
      updatedAt: typeof row.updatedAt === "string" && row.updatedAt ? row.updatedAt : new Date().toISOString(),
    }) as MarketingCampaignRecord)
    .filter((row) => row.code && row.title && Number.isFinite(row.discountValue));
  return rows.length > 0 ? rows : DEFAULT_CAMPAIGNS;
}

function sanitizePlans(value: unknown): MarketingSubscriptionPlanRecord[] {
  const fallback = DEFAULT_PUBLIC_SUBSCRIPTION_PLANS.map((plan) => ({ ...plan, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })) as MarketingSubscriptionPlanRecord[];
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row, index) => ({
      id: typeof row.id === "string" && row.id ? row.id : `plan-${index + 1}`,
      slug: typeof row.slug === "string" ? row.slug.trim() : "",
      name: typeof row.name === "string" ? row.name.trim() : "",
      tagline: typeof row.tagline === "string" ? row.tagline.trim() : null,
      description: typeof row.description === "string" ? row.description.trim() : null,
      serviceTypes: sanitizeJobTypes(row.serviceTypes),
      cadenceOptions: sanitizeStringList(row.cadenceOptions, 12, 60),
      startingPrice: row.startingPrice == null ? null : Number(row.startingPrice),
      priceLabel: typeof row.priceLabel === "string" ? row.priceLabel.trim() : null,
      features: sanitizeStringList(row.features, 20, 200),
      themeKey: typeof row.themeKey === "string" ? row.themeKey.trim() : null,
      ctaLabel: typeof row.ctaLabel === "string" ? row.ctaLabel.trim() : null,
      ctaHref: typeof row.ctaHref === "string" ? row.ctaHref.trim() : null,
      isPublished: row.isPublished !== false,
      sortOrder: Number(row.sortOrder ?? index),
      createdAt: typeof row.createdAt === "string" && row.createdAt ? row.createdAt : new Date().toISOString(),
      updatedAt: typeof row.updatedAt === "string" && row.updatedAt ? row.updatedAt : new Date().toISOString(),
    }))
    .filter((row) => row.slug && row.name);
  return rows.length > 0 ? rows.sort((a, b) => a.sortOrder - b.sortOrder) : fallback;
}

async function readJsonSetting<T>(key: string, fallback: T, sanitizer: (value: unknown) => T): Promise<T> {
  if (!hasDatabaseUrl()) {
    return fallback;
  }

  try {
    const row = await db.appSetting.findUnique({ where: { key } });
    if (!row) return fallback;
    return sanitizer(row.value);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[marketing/store] Falling back for ${key}:`, error);
    }
    return fallback;
  }
}

async function writeJsonSetting<T>(key: string, value: T) {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value: value as any },
    update: { value: value as any },
  });
}

export async function getMarketingCampaigns() {
  return readJsonSetting(CAMPAIGNS_KEY, DEFAULT_CAMPAIGNS, sanitizeCampaigns);
}

export async function saveMarketingCampaigns(campaigns: MarketingCampaignRecord[]) {
  await writeJsonSetting(CAMPAIGNS_KEY, campaigns);
}

export async function getMarketingSubscriptionPlans() {
  return readJsonSetting(PLANS_KEY, DEFAULT_PUBLIC_SUBSCRIPTION_PLANS as any, sanitizePlans);
}

export async function saveMarketingSubscriptionPlans(plans: MarketingSubscriptionPlanRecord[]) {
  await writeJsonSetting(PLANS_KEY, plans);
}
