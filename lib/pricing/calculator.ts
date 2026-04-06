import { db } from "@/lib/db";
import { JobType } from "@prisma/client";
import { applyCampaignDiscount, validateDiscountCampaign } from "@/lib/marketing/campaigns";
import { supportsDirectPriceBookQuery } from "@/lib/marketing/persistence";
import type { MarketedJobTypeValue } from "@/lib/marketing/job-types";

interface QuoteInput {
  serviceType: MarketedJobTypeValue;
  bedrooms?: number;
  bathrooms?: number;
  floors?: number;
  areaBand?: "compact" | "standard" | "large" | "extra_large";
  areaSqm?: number;
  serviceUnits?: number;
  windowCount?: number;
  windowAccess?: "minimal" | "standard" | "extensive";
  parkingAccess?: "easy" | "street" | "limited";
  frequency?: "one_off" | "weekly" | "fortnightly" | "monthly";
  hasBalcony?: boolean;
  exteriorAccess?: boolean;
  addOns?: {
    oven?: boolean;
    fridge?: boolean;
    heavyMess?: boolean;
    sameDay?: boolean;
    furnished?: boolean;
    pets?: boolean;
    outdoorArea?: boolean;
  };
  conditionLevel?: "light" | "standard" | "heavy";
  promoCode?: string;
}

interface QuoteResult {
  baseRate: number;
  addOnTotal: number;
  multiplier: number;
  subtotal: number;
  gst: number;
  total: number;
  discountTotal?: number;
  appliedCampaign?: {
    code: string;
    title: string;
    discountType: string;
    discountValue: number;
  } | null;
  lineItems: { label: string; unitPrice: number; qty: number; total: number }[];
  isEstimate: boolean;
  requiresAdminApproval: boolean;
  pricingMode: "exact" | "fallback";
}

const AREA_SQM_FALLBACKS = {
  compact: 60,
  standard: 120,
  large: 220,
  extra_large: 350,
} as const;

const LOCAL_ADD_ON_RATES = {
  oven: 35,
  fridge: 28,
  balcony: 18,
  heavyMess: 40,
  sameDay: 30,
  furnished: 20,
  pets: 18,
  outdoorArea: 28,
  additionalFloor: 18,
  streetParking: 6,
  limitedParking: 14,
  standardWindowAccess: 12,
  extensiveWindows: 24,
} as const;

const CONDITION_MULTIPLIERS = {
  light: 0.94,
  standard: 1,
  heavy: 1.18,
} as const;

const FREQUENCY_MULTIPLIERS = {
  one_off: 1,
  weekly: 0.92,
  fortnightly: 0.96,
  monthly: 0.985,
} as const;

function makeManualQuoteError(message: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = "MANUAL_REVIEW_REQUIRED";
  return error;
}

function finalizeQuote({
  baseRate,
  addOnTotal,
  multiplier,
  lineItems,
  input,
  pricingMode,
}: {
  baseRate: number;
  addOnTotal: number;
  multiplier: number;
  lineItems: QuoteResult["lineItems"];
  input: QuoteInput;
  pricingMode: QuoteResult["pricingMode"];
}): Promise<QuoteResult> {
  return (async () => {
    const subtotalBeforeDiscount = Number(((baseRate + addOnTotal) * multiplier).toFixed(2));

    let discountTotal = 0;
    let appliedCampaign: QuoteResult["appliedCampaign"] = null;
    if (input.promoCode?.trim()) {
      const campaignValidation = await validateDiscountCampaign(input.promoCode, input.serviceType, subtotalBeforeDiscount);
      if (!campaignValidation.valid) {
        const error = new Error(campaignValidation.reason) as Error & { code?: string };
        error.code = "INVALID_CAMPAIGN";
        throw error;
      }
      discountTotal = Number(applyCampaignDiscount(subtotalBeforeDiscount, campaignValidation.campaign).toFixed(2));
      appliedCampaign = {
        code: campaignValidation.campaign.code,
        title: campaignValidation.campaign.title,
        discountType: campaignValidation.campaign.discountType,
        discountValue: campaignValidation.campaign.discountValue,
      };
      if (discountTotal > 0) {
        lineItems.push({ label: `Campaign: ${campaignValidation.campaign.code}`, unitPrice: -discountTotal, qty: 1, total: -discountTotal });
      }
    }

    const subtotal = Number(Math.max(0, subtotalBeforeDiscount - discountTotal).toFixed(2));
    const gst = Number((subtotal * 0.1).toFixed(2));
    const total = Number((subtotal + gst).toFixed(2));

    return {
      baseRate,
      addOnTotal,
      multiplier,
      subtotal,
      gst,
      total,
      discountTotal,
      appliedCampaign,
      lineItems,
      isEstimate: true,
      requiresAdminApproval: true,
      pricingMode,
    };
  })();
}

function addCommonLocalAdjustments(input: QuoteInput, lineItems: QuoteResult["lineItems"]) {
  let addOnTotal = 0;
  const addFlatCharge = (enabled: boolean | undefined, amount: number, label: string) => {
    if (!enabled || amount <= 0) return;
    addOnTotal += amount;
    lineItems.push({ label, unitPrice: amount, qty: 1, total: amount });
  };

  addFlatCharge(input.addOns?.oven, LOCAL_ADD_ON_RATES.oven, "Oven clean");
  addFlatCharge(input.addOns?.fridge, LOCAL_ADD_ON_RATES.fridge, "Fridge clean");
  addFlatCharge(input.hasBalcony, LOCAL_ADD_ON_RATES.balcony, "Balcony");
  addFlatCharge(input.addOns?.heavyMess, LOCAL_ADD_ON_RATES.heavyMess, "Heavy mess surcharge");
  addFlatCharge(input.addOns?.sameDay, LOCAL_ADD_ON_RATES.sameDay, "Priority turnaround surcharge");
  addFlatCharge(input.addOns?.furnished, LOCAL_ADD_ON_RATES.furnished, "Furnished property allowance");
  addFlatCharge(input.addOns?.pets, LOCAL_ADD_ON_RATES.pets, "Pets / pet hair allowance");
  addFlatCharge(input.addOns?.outdoorArea, LOCAL_ADD_ON_RATES.outdoorArea, "Outdoor area allowance");

  const extraFloors = Math.max(0, (input.floors ?? 1) - 1);
  if (extraFloors > 0) {
    const total = extraFloors * LOCAL_ADD_ON_RATES.additionalFloor;
    addOnTotal += total;
    lineItems.push({ label: "Additional floor access", unitPrice: LOCAL_ADD_ON_RATES.additionalFloor, qty: extraFloors, total });
  }

  const windowCharge = input.windowAccess === "extensive"
    ? LOCAL_ADD_ON_RATES.extensiveWindows
    : input.windowAccess === "standard"
      ? LOCAL_ADD_ON_RATES.standardWindowAccess
      : 0;
  if (windowCharge > 0) {
    addOnTotal += windowCharge;
    lineItems.push({ label: "Window access allowance", unitPrice: windowCharge, qty: 1, total: windowCharge });
  }

  const parkingCharge = input.parkingAccess === "limited"
    ? LOCAL_ADD_ON_RATES.limitedParking
    : input.parkingAccess === "street"
      ? LOCAL_ADD_ON_RATES.streetParking
      : 0;
  if (parkingCharge > 0) {
    addOnTotal += parkingCharge;
    lineItems.push({ label: "Access / parking allowance", unitPrice: parkingCharge, qty: 1, total: parkingCharge });
  }

  return addOnTotal;
}

async function calculateLocalMarketingQuote(input: QuoteInput): Promise<QuoteResult> {
  const lineItems: QuoteResult["lineItems"] = [];
  let baseRate = 0;

  switch (input.serviceType) {
    case "SPRING_CLEANING": {
      const bedrooms = Math.max(1, input.bedrooms ?? 2);
      const bathrooms = Math.max(1, input.bathrooms ?? 1);
      const baseVisit = 110;
      const bedroomRate = 42;
      const bathroomRate = 28;
      lineItems.push({ label: "Spring clean base visit", unitPrice: baseVisit, qty: 1, total: baseVisit });
      lineItems.push({ label: "Bedrooms", unitPrice: bedroomRate, qty: bedrooms, total: bedrooms * bedroomRate });
      lineItems.push({ label: "Bathrooms", unitPrice: bathroomRate, qty: bathrooms, total: bathrooms * bathroomRate });
      baseRate = baseVisit + bedrooms * bedroomRate + bathrooms * bathroomRate;
      break;
    }

    case "CARPET_STEAM_CLEAN": {
      const rooms = Math.max(1, Number(input.serviceUnits ?? input.bedrooms ?? 1));
      const firstRoom = 119;
      const additionalRoom = 45;
      baseRate = firstRoom + Math.max(0, rooms - 1) * additionalRoom;
      lineItems.push({ label: "Carpet steam clean", unitPrice: firstRoom, qty: 1, total: firstRoom });
      if (rooms > 1) {
        lineItems.push({ label: "Additional carpeted room(s)", unitPrice: additionalRoom, qty: rooms - 1, total: (rooms - 1) * additionalRoom });
      }
      break;
    }

    case "UPHOLSTERY_CLEANING": {
      const pieces = Math.max(1, Number(input.serviceUnits ?? 1));
      const firstPiece = 95;
      const additionalPiece = 60;
      baseRate = firstPiece + Math.max(0, pieces - 1) * additionalPiece;
      lineItems.push({ label: "Upholstery cleaning", unitPrice: firstPiece, qty: 1, total: firstPiece });
      if (pieces > 1) {
        lineItems.push({ label: "Additional upholstery item(s)", unitPrice: additionalPiece, qty: pieces - 1, total: (pieces - 1) * additionalPiece });
      }
      break;
    }

    case "TILE_GROUT_CLEANING": {
      const areaSqm = Math.max(25, Number(input.areaSqm ?? AREA_SQM_FALLBACKS[input.areaBand ?? "standard"]));
      const baseVisit = 90;
      const ratePerSqm = 3.4;
      const areaTotal = Number((areaSqm * ratePerSqm).toFixed(2));
      baseRate = baseVisit + areaTotal;
      lineItems.push({ label: "Tile and grout setup", unitPrice: baseVisit, qty: 1, total: baseVisit });
      lineItems.push({ label: "Tile / grout area", unitPrice: ratePerSqm, qty: areaSqm, total: areaTotal });
      break;
    }

    case "WINDOW_CLEAN": {
      const windows = Math.max(8, Number(input.windowCount ?? input.serviceUnits ?? 10));
      const baseVisit = 85;
      const perWindow = 9.5;
      const total = Number((windows * perWindow).toFixed(2));
      baseRate = baseVisit + total;
      lineItems.push({ label: "Window cleaning setup", unitPrice: baseVisit, qty: 1, total: baseVisit });
      lineItems.push({ label: "Windows", unitPrice: perWindow, qty: windows, total });
      if (input.exteriorAccess) {
        const exteriorAllowance = 45;
        baseRate += exteriorAllowance;
        lineItems.push({ label: "Exterior access allowance", unitPrice: exteriorAllowance, qty: 1, total: exteriorAllowance });
      }
      break;
    }

    case "PRESSURE_WASH": {
      const areaSqm = Math.max(40, Number(input.areaSqm ?? AREA_SQM_FALLBACKS[input.areaBand ?? "standard"]));
      const baseVisit = 110;
      const ratePerSqm = 2.75;
      const total = Number((areaSqm * ratePerSqm).toFixed(2));
      baseRate = baseVisit + total;
      lineItems.push({ label: "Pressure washing setup", unitPrice: baseVisit, qty: 1, total: baseVisit });
      lineItems.push({ label: "Pressure wash area", unitPrice: ratePerSqm, qty: areaSqm, total });
      break;
    }

    case "LAWN_MOWING": {
      const areaSqm = Math.max(80, Number(input.areaSqm ?? AREA_SQM_FALLBACKS[input.areaBand ?? "standard"]));
      const baseVisit = 65;
      const ratePerSqm = 0.38;
      const total = Number((areaSqm * ratePerSqm).toFixed(2));
      baseRate = baseVisit + total;
      lineItems.push({ label: "Lawn service setup", unitPrice: baseVisit, qty: 1, total: baseVisit });
      lineItems.push({ label: "Lawn area", unitPrice: ratePerSqm, qty: areaSqm, total });
      break;
    }

    case "POST_CONSTRUCTION":
      throw makeManualQuoteError("Post-construction cleaning requires manual review so we can confirm dust level, residue, and safe access before pricing.");

    case "COMMERCIAL_RECURRING":
      throw makeManualQuoteError("Commercial cleaning requests are reviewed manually so we can quote properly against site size, access windows, and recurrence.");

    case "MOLD_TREATMENT":
      throw makeManualQuoteError("Mould treatment requires manual review so we can assess severity, safety, and surface conditions before confirming price.");

    case "GUTTER_CLEANING":
      throw makeManualQuoteError("Gutter cleaning requires manual review because access height, debris load, and safety conditions need to be confirmed first.");

    default:
      throw makeManualQuoteError("This service needs a manual review before pricing is confirmed.");
  }

  const addOnTotal = addCommonLocalAdjustments(input, lineItems);
  const multiplier = Number(((CONDITION_MULTIPLIERS[input.conditionLevel ?? "standard"] ?? 1) * (FREQUENCY_MULTIPLIERS[input.frequency ?? "one_off"] ?? 1)).toFixed(4));
  return finalizeQuote({
    baseRate,
    addOnTotal,
    multiplier,
    lineItems,
    input,
    pricingMode: "fallback",
  });
}

export async function calculateQuote(input: QuoteInput): Promise<QuoteResult> {
  if (!supportsDirectPriceBookQuery(input.serviceType)) {
    return calculateLocalMarketingQuote(input);
  }

  let allRows: Array<{
    bedrooms: number | null;
    bathrooms: number | null;
    baseRate: number;
    addOns: unknown;
    multipliers: unknown;
  }> = [];

  try {
    allRows = await db.priceBook.findMany({
      where: {
        jobType: input.serviceType as JobType,
        isActive: true,
      },
      orderBy: [{ bedrooms: "asc" }, { bathrooms: "asc" }, { baseRate: "asc" }],
      take: 50,
      select: {
        bedrooms: true,
        bathrooms: true,
        baseRate: true,
        addOns: true,
        multipliers: true,
      },
    });
  } catch {
    return calculateLocalMarketingQuote(input);
  }

  let entry =
    allRows.find(
      (row) =>
        row.bedrooms === (input.bedrooms ?? null) &&
        row.bathrooms === (input.bathrooms ?? null)
    ) ?? null;

  let pricingMode: QuoteResult["pricingMode"] = "exact";

  if (!entry) {
    entry =
      allRows.find(
        (row) =>
          (row.bedrooms ?? 0) <= (input.bedrooms ?? 0) &&
          (row.bathrooms ?? 0) <= (input.bathrooms ?? 0)
      ) ??
      allRows.find((row) => (row.bedrooms ?? 0) === 0 && (row.bathrooms ?? 0) === 0) ??
      allRows[0] ??
      null;

    if (entry) pricingMode = "fallback";
  }

  if (!entry) {
    const error = new Error(`No price book entry found for ${input.serviceType}`) as Error & { code?: string };
    error.code = "NO_PRICEBOOK_MATCH";
    throw error;
  }

  const addOns = (entry.addOns as Record<string, number | string | boolean | undefined>) ?? {};
  const multipliers = (entry.multipliers as Record<string, Record<string, number>>) ?? {};

  const lineItems: QuoteResult["lineItems"] = [];
  let baseRate = Number(entry.baseRate || 0);
  lineItems.push({ label: "Base rate", unitPrice: Number(entry.baseRate), qty: 1, total: Number(entry.baseRate) });
  const baseBedrooms = entry.bedrooms ?? 0;
  const baseBathrooms = entry.bathrooms ?? 0;
  const requestedBedrooms = input.bedrooms ?? baseBedrooms;
  const requestedBathrooms = input.bathrooms ?? baseBathrooms;
  const extraBedroomRate = Number(addOns.additionalBedroom ?? addOns.extraBedroom ?? addOns.perAdditionalBedroom ?? 0);
  const extraBathroomRate = Number(addOns.additionalBathroom ?? addOns.extraBathroom ?? addOns.perAdditionalBathroom ?? 0);
  const extraBedrooms = Math.max(0, requestedBedrooms - baseBedrooms);
  const extraBathrooms = Math.max(0, requestedBathrooms - baseBathrooms);

  if (extraBedrooms > 0 && extraBedroomRate > 0) {
    const total = extraBedrooms * extraBedroomRate;
    baseRate += total;
    lineItems.push({ label: "Additional bedroom(s)", unitPrice: extraBedroomRate, qty: extraBedrooms, total });
  }
  if (extraBathrooms > 0 && extraBathroomRate > 0) {
    const total = extraBathrooms * extraBathroomRate;
    baseRate += total;
    lineItems.push({ label: "Additional bathroom(s)", unitPrice: extraBathroomRate, qty: extraBathrooms, total });
  }

  let addOnTotal = 0;
  const maybeAddFlatCharge = (enabled: boolean | undefined, key: string, label: string) => {
    const amount = Number(addOns[key] ?? 0);
    if (!enabled || amount <= 0) return;
    addOnTotal += amount;
    lineItems.push({ label, unitPrice: amount, qty: 1, total: amount });
  };

  maybeAddFlatCharge(input.addOns?.oven, "oven", "Oven clean");
  maybeAddFlatCharge(input.addOns?.fridge, "fridge", "Fridge clean");
  maybeAddFlatCharge(input.hasBalcony, "balcony", "Balcony");
  maybeAddFlatCharge(input.addOns?.heavyMess, "heavyMess", "Heavy mess surcharge");
  maybeAddFlatCharge(input.addOns?.sameDay, "sameDay", "Priority turnaround surcharge");
  maybeAddFlatCharge(input.addOns?.furnished, "furnished", "Furnished property allowance");
  maybeAddFlatCharge(input.addOns?.pets, "pets", "Pets / pet hair allowance");
  maybeAddFlatCharge(input.addOns?.outdoorArea, "outdoorArea", "Outdoor area allowance");

  const extraFloors = Math.max(0, (input.floors ?? 1) - 1);
  const extraFloorRate = Number(addOns.additionalFloor ?? addOns.extraFloor ?? 18);
  if (extraFloors > 0 && extraFloorRate > 0) {
    const total = extraFloors * extraFloorRate;
    addOnTotal += total;
    lineItems.push({ label: "Additional floor access", unitPrice: extraFloorRate, qty: extraFloors, total });
  }

  const windowAccessChargeMap = {
    minimal: 0,
    standard: Number(addOns.standardWindowAccess ?? 0),
    extensive: Number(addOns.extensiveWindows ?? 22),
  } as const;
  const windowCharge = windowAccessChargeMap[input.windowAccess ?? "standard"];
  if (windowCharge > 0) {
    addOnTotal += windowCharge;
    lineItems.push({ label: "Window access allowance", unitPrice: windowCharge, qty: 1, total: windowCharge });
  }

  const parkingChargeMap = {
    easy: 0,
    street: Number(addOns.streetParking ?? 5),
    limited: Number(addOns.limitedParking ?? 12),
  } as const;
  const parkingCharge = parkingChargeMap[input.parkingAccess ?? "easy"];
  if (parkingCharge > 0) {
    addOnTotal += parkingCharge;
    lineItems.push({ label: "Access / parking allowance", unitPrice: parkingCharge, qty: 1, total: parkingCharge });
  }

  const conditionLevel = input.conditionLevel ?? "standard";
  const conditionMultiplier = multipliers?.conditionLevel?.[conditionLevel] ?? 1;
  const frequency = input.frequency ?? "one_off";
  const frequencyMultiplier = FREQUENCY_MULTIPLIERS[frequency];
  const multiplier = Number((conditionMultiplier * frequencyMultiplier).toFixed(4));

  const minimumPrice = Number(addOns.minimumPrice ?? addOns.minPrice ?? 0);
  if (minimumPrice > 0) {
    const projected = Number(((baseRate + addOnTotal) * multiplier).toFixed(2));
    if (projected < minimumPrice) {
      const minAdjustment = Number((minimumPrice - projected).toFixed(2));
      addOnTotal += minAdjustment;
      lineItems.push({ label: "Minimum service charge adjustment", unitPrice: minAdjustment, qty: 1, total: minAdjustment });
    }
  }

  return finalizeQuote({
    baseRate,
    addOnTotal,
    multiplier,
    lineItems,
    input,
    pricingMode,
  });
}
