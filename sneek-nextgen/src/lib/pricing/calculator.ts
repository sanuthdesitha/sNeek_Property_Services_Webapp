import { prisma } from "@/lib/db/prisma";
import type { JobType } from "@prisma/client";

interface PricingInput {
  jobType: string;
  bedrooms: number;
  bathrooms: number;
  addOns?: Record<string, boolean>;
  conditionLevel?: "light" | "standard" | "heavy";
  promoCode?: string;
}

interface PricingResult {
  baseRate: number;
  addOnsTotal: number;
  multiplier: number;
  subtotal: number;
  gstAmount: number;
  discount: number;
  total: number;
  lineItems: { label: string; amount: number }[];
}

export async function calculatePrice(input: PricingInput): Promise<PricingResult> {
  const lineItems: { label: string; amount: number }[] = [];

  // Get base rate from price book
  const priceBookEntry = await prisma.priceBook.findFirst({
    where: {
      jobType: input.jobType as JobType,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
    },
  });

  // Fallback: find closest match
  let baseRate = priceBookEntry?.baseRate ?? 0;
  if (!priceBookEntry) {
    const fallback = await prisma.priceBook.findFirst({
      where: { jobType: input.jobType as JobType },
      orderBy: [{ bedrooms: "asc" }, { bathrooms: "asc" }],
    });
    baseRate = fallback?.baseRate ?? 0;
  }

  lineItems.push({ label: "Base rate", amount: baseRate });

  // Apply add-ons
  let addOnsTotal = 0;
  if (input.addOns && priceBookEntry?.addOns) {
    const addOns = priceBookEntry.addOns as Record<string, number>;
    for (const [key, enabled] of Object.entries(input.addOns)) {
      if (enabled && addOns[key]) {
        addOnsTotal += addOns[key];
        lineItems.push({ label: `Add-on: ${key}`, amount: addOns[key] });
      }
    }
  }

  // Apply condition multiplier
  let multiplier = 1;
  if (input.conditionLevel && priceBookEntry?.multipliers) {
    const multipliers = priceBookEntry.multipliers as Record<string, Record<string, number>>;
    multiplier = multipliers.conditionLevel?.[input.conditionLevel] ?? 1;
  }

  const subtotal = (baseRate + addOnsTotal) * multiplier;

  // Apply promo code discount
  let discount = 0;
  if (input.promoCode) {
    const campaign = await prisma.discountCampaign.findFirst({
      where: {
        code: input.promoCode,
        isActive: true,
        OR: [
          { startsAt: null, endsAt: null },
          { startsAt: { lte: new Date() }, endsAt: { gte: new Date() } },
          { startsAt: { lte: new Date() }, endsAt: null },
          { startsAt: null, endsAt: { gte: new Date() } },
        ],
      },
    });

    if (campaign && (!campaign.usageLimit || campaign.usageCount < campaign.usageLimit)) {
      if (campaign.discountType === "PERCENT") {
        discount = subtotal * (campaign.discountValue / 100);
      } else {
        discount = Math.min(campaign.discountValue, subtotal);
      }
    }
  }

  const afterDiscount = subtotal - discount;
  const gstAmount = afterDiscount * 0.1; // 10% GST
  const total = afterDiscount + gstAmount;

  return {
    baseRate,
    addOnsTotal,
    multiplier,
    subtotal,
    gstAmount: Math.round(gstAmount * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    total: Math.round(total * 100) / 100,
    lineItems,
  };
}

export async function calculateEstimatedHours(
  jobType: string,
  bedrooms: number,
  bathrooms: number,
  conditionLevel: "light" | "standard" | "heavy" = "standard",
  addOns?: Record<string, boolean>,
): Promise<number> {
  // Base hours per job type
  const baseHours: Record<string, number> = {
    AIRBNB_TURNOVER: 2.5,
    DEEP_CLEAN: 5,
    END_OF_LEASE: 6,
    GENERAL_CLEAN: 3,
    POST_CONSTRUCTION: 8,
    PRESSURE_WASH: 3,
    WINDOW_CLEAN: 2,
    LAWN_MOWING: 1.5,
    SPECIAL_CLEAN: 3,
    COMMERCIAL_RECURRING: 4,
    CARPET_STEAM_CLEAN: 3,
    MOLD_TREATMENT: 4,
    UPHOLSTERY_CLEANING: 2,
    TILE_GROUT_CLEANING: 3,
    GUTTER_CLEANING: 2,
    SPRING_CLEANING: 5,
  };

  let hours = baseHours[jobType] ?? 3;

  // Adjust for bedrooms and bathrooms
  hours += (bedrooms - 1) * 0.5;
  hours += (bathrooms - 1) * 0.75;

  // Condition multiplier
  const conditionMultipliers = { light: 0.85, standard: 1, heavy: 1.3 };
  hours *= conditionMultipliers[conditionLevel];

  // Add-on hours
  const addOnHours: Record<string, number> = {
    oven: 0.5,
    fridge: 0.5,
    balcony: 0.25,
    heavyMess: 1,
    sameDay: 0,
  };

  if (addOns) {
    for (const [key, enabled] of Object.entries(addOns)) {
      if (enabled && addOnHours[key]) {
        hours += addOnHours[key];
      }
    }
  }

  return Math.round(hours * 10) / 10;
}
