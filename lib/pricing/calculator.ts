import { db } from "@/lib/db";
import { JobType } from "@prisma/client";
import { applyCampaignDiscount, validateDiscountCampaign } from "@/lib/marketing/campaigns";
import { supportsDirectPriceBookQuery } from "@/lib/marketing/persistence";
import type { MarketedJobTypeValue } from "@/lib/marketing/job-types";
import { getAppSettings } from "@/lib/settings";
import type { BlueCleanQuotePricingSettings, BlueCleanRoomPackagePricing } from "@/lib/settings";
import { calculateGstBreakdown, type GstSettings } from "@/lib/pricing/gst";

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
  addOns?: Record<string, boolean | number | undefined>;
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
  oven: 70,
  fridge: 45,
  fridgeFull: 75,
  freezer: 30,
  balcony: 28,
  smallBalcony: 28,
  largeBalcony: 55,
  heavyMess: 85,
  sameDay: 65,
  furnished: 35,
  pets: 30,
  outdoorArea: 45,
  largeKitchen: 45,
  grill: 45,
  rangehood: 35,
  dishwasher: 30,
  insideCupboards: 85,
  pantry: 45,
  interiorWindows: 75,
  exteriorWindows: 110,
  slidingGlassDoor: 35,
  blindsShutters: 70,
  wallSpotClean: 65,
  wallWashing: 180,
  ceilingFans: 35,
  airConditionerVents: 45,
  wardrobe: 45,
  garage: 60,
  deckPatio: 50,
  alfresco: 65,
  pergola: 55,
  carpetSteam: 85,
  changeBedsheets: 18,
  washDishes: 30,
  laundryLoad: 25,
  laundryFold: 35,
  laundryCloset: 35,
  rumpusRoom: 55,
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
  weekly: 1,
  fortnightly: 1,
  monthly: 1,
} as const;

const BLUE_CLEAN_STYLE_SERVICES = new Set<MarketedJobTypeValue>([
  "GENERAL_CLEAN",
  "AIRBNB_TURNOVER",
  "DEEP_CLEAN",
  "SPRING_CLEANING",
  "SPECIAL_CLEAN",
  "END_OF_LEASE",
  "POST_CONSTRUCTION",
  "CARPET_STEAM_CLEAN",
  "UPHOLSTERY_CLEANING",
  "WINDOW_CLEAN",
  "PRESSURE_WASH",
]);

function makeManualQuoteError(message: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = "MANUAL_REVIEW_REQUIRED";
  return error;
}

function selectionQuantity(value: boolean | number | undefined) {
  if (typeof value === "number") return Math.max(0, value);
  return value ? 1 : 0;
}

function finalizeQuote({
  baseRate,
  addOnTotal,
  multiplier,
  lineItems,
  input,
  pricingMode,
  gstSettings,
}: {
  baseRate: number;
  addOnTotal: number;
  multiplier: number;
  lineItems: QuoteResult["lineItems"];
  input: QuoteInput;
  pricingMode: QuoteResult["pricingMode"];
  gstSettings: GstSettings;
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

    const { subtotal, gstAmount: gst, totalAmount: total } = calculateGstBreakdown(
      Math.max(0, subtotalBeforeDiscount - discountTotal),
      gstSettings
    );

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
  const addFlatCharge = (selection: boolean | number | undefined, amount: number, label: string) => {
    const qty = selectionQuantity(selection);
    if (qty <= 0 || amount <= 0) return;
    const total = qty * amount;
    addOnTotal += total;
    lineItems.push({ label, unitPrice: amount, qty, total });
  };

  addFlatCharge(input.addOns?.oven, LOCAL_ADD_ON_RATES.oven, "Oven clean");
  addFlatCharge(input.addOns?.fridge, LOCAL_ADD_ON_RATES.fridge, "Fridge clean");
  addFlatCharge(input.addOns?.fridgeFull, LOCAL_ADD_ON_RATES.fridgeFull, "Full fridge clean");
  addFlatCharge(input.addOns?.freezer, LOCAL_ADD_ON_RATES.freezer, "Freezer clean");
  addFlatCharge(input.hasBalcony ? 1 : undefined, LOCAL_ADD_ON_RATES.balcony, "Balcony");
  addFlatCharge(input.addOns?.smallBalcony, LOCAL_ADD_ON_RATES.smallBalcony, "Small balcony");
  addFlatCharge(input.addOns?.largeBalcony, LOCAL_ADD_ON_RATES.largeBalcony, "Large balcony");
  addFlatCharge(input.addOns?.heavyMess, LOCAL_ADD_ON_RATES.heavyMess, "Heavy mess surcharge");
  addFlatCharge(input.addOns?.sameDay, LOCAL_ADD_ON_RATES.sameDay, "Priority turnaround surcharge");
  addFlatCharge(input.addOns?.furnished, LOCAL_ADD_ON_RATES.furnished, "Furnished property allowance");
  addFlatCharge(input.addOns?.pets, LOCAL_ADD_ON_RATES.pets, "Pets / pet hair allowance");
  addFlatCharge(input.addOns?.outdoorArea, LOCAL_ADD_ON_RATES.outdoorArea, "Outdoor area allowance");
  addFlatCharge(input.addOns?.largeKitchen, LOCAL_ADD_ON_RATES.largeKitchen, "Large kitchen allowance");
  addFlatCharge(input.addOns?.grill, LOCAL_ADD_ON_RATES.grill, "Grill clean");
  addFlatCharge(input.addOns?.rangehood, LOCAL_ADD_ON_RATES.rangehood, "Rangehood and filter clean");
  addFlatCharge(input.addOns?.dishwasher, LOCAL_ADD_ON_RATES.dishwasher, "Dishwasher clean");
  addFlatCharge(input.addOns?.insideCupboards, LOCAL_ADD_ON_RATES.insideCupboards, "Inside cupboards and drawers");
  addFlatCharge(input.addOns?.pantry, LOCAL_ADD_ON_RATES.pantry, "Pantry clean");
  addFlatCharge(input.addOns?.interiorWindows, LOCAL_ADD_ON_RATES.interiorWindows, "Interior windows and tracks");
  addFlatCharge(input.addOns?.exteriorWindows, LOCAL_ADD_ON_RATES.exteriorWindows, "Exterior windows");
  addFlatCharge(input.addOns?.slidingGlassDoor, LOCAL_ADD_ON_RATES.slidingGlassDoor, "Sliding glass door and tracks");
  addFlatCharge(input.addOns?.blindsShutters, LOCAL_ADD_ON_RATES.blindsShutters, "Blinds / shutters wet wipe");
  addFlatCharge(input.addOns?.wallSpotClean, LOCAL_ADD_ON_RATES.wallSpotClean, "Wall spot clean");
  addFlatCharge(input.addOns?.wallWashing, LOCAL_ADD_ON_RATES.wallWashing, "Wall washing");
  addFlatCharge(input.addOns?.ceilingFans, LOCAL_ADD_ON_RATES.ceilingFans, "Ceiling fan clean");
  addFlatCharge(input.addOns?.airConditionerVents, LOCAL_ADD_ON_RATES.airConditionerVents, "Air conditioner vent clean");
  addFlatCharge(input.addOns?.wardrobe, LOCAL_ADD_ON_RATES.wardrobe, "Wardrobe clean");
  addFlatCharge(input.addOns?.garage, LOCAL_ADD_ON_RATES.garage, "Garage sweep and tidy");
  addFlatCharge(input.addOns?.deckPatio, LOCAL_ADD_ON_RATES.deckPatio, "Deck / patio clean");
  addFlatCharge(input.addOns?.alfresco, LOCAL_ADD_ON_RATES.alfresco, "Alfresco area clean");
  addFlatCharge(input.addOns?.pergola, LOCAL_ADD_ON_RATES.pergola, "Pergola clean");
  addFlatCharge(input.addOns?.carpetSteam, LOCAL_ADD_ON_RATES.carpetSteam, "Carpet steam clean allowance");
  addFlatCharge(input.addOns?.changeBedsheets, LOCAL_ADD_ON_RATES.changeBedsheets, "Change bedsheets");
  addFlatCharge(input.addOns?.washDishes, LOCAL_ADD_ON_RATES.washDishes, "Wash dishes");
  addFlatCharge(input.addOns?.laundryLoad, LOCAL_ADD_ON_RATES.laundryLoad, "Laundry load / hang out");
  addFlatCharge(input.addOns?.laundryFold, LOCAL_ADD_ON_RATES.laundryFold, "Laundry fold");
  addFlatCharge(input.addOns?.laundryCloset, LOCAL_ADD_ON_RATES.laundryCloset, "Laundry closet clean");
  addFlatCharge(input.addOns?.rumpusRoom, LOCAL_ADD_ON_RATES.rumpusRoom, "Rumpus room clean");

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

function addBlueCleanExtras(
  input: QuoteInput,
  lineItems: QuoteResult["lineItems"],
  extraRates: BlueCleanQuotePricingSettings["extraRates"]
) {
  let addOnTotal = 0;
  const rate = (key: string) => Number(extraRates[key] ?? 0);
  const addFlatCharge = (selection: boolean | number | undefined, amount: number, label: string) => {
    const qty = selectionQuantity(selection);
    if (qty <= 0 || amount <= 0) return;
    const total = qty * amount;
    addOnTotal += total;
    lineItems.push({ label, unitPrice: amount, qty, total });
  };

  addFlatCharge(input.addOns?.studyArea, rate("studyArea"), "Study area");
  addFlatCharge(input.addOns?.oven, rate("oven"), "Oven clean");
  addFlatCharge(input.addOns?.insideCupboards, rate("insideCupboards"), "Inside cupboards area set");
  addFlatCharge(input.addOns?.blindsShutters, rate("blindsShutters"), "Venetian / shutter blind wash");
  addFlatCharge(input.addOns?.wallWashing, rate("wallWashing"), "Wall wash per level");
  addFlatCharge(input.addOns?.fridge, rate("fridge"), "Inside fridge");
  addFlatCharge(input.addOns?.extraLivingArea, rate("extraLivingArea"), "Extra living area");
  addFlatCharge(input.addOns?.largeKitchen, rate("largeKitchen"), "Extra kitchen");
  addFlatCharge(
    Math.max(selectionQuantity(input.hasBalcony), selectionQuantity(input.addOns?.largeBalcony), selectionQuantity(input.addOns?.smallBalcony)),
    rate("balcony"),
    "Balcony sweep, mop, and glass doors"
  );
  addFlatCharge(input.addOns?.kingQueenBedMaking, rate("kingQueenBedMaking"), "King / queen bed making");
  addFlatCharge(input.addOns?.singleDoubleBedMaking, rate("singleDoubleBedMaking"), "Single / double bed making");
  addFlatCharge(input.addOns?.bbqClean, rate("bbqClean"), "BBQ clean");
  addFlatCharge(input.addOns?.garage, rate("garage"), "Garage");
  addFlatCharge(input.addOns?.laundryFold, rate("laundryFold"), "Wash, dry, fold per hour");
  addFlatCharge(input.addOns?.washDishes, rate("washDishes"), "Dishes wash up per hour");
  addFlatCharge(input.addOns?.extraToilet, rate("extraToilet"), "Extra toilet");
  addFlatCharge(Math.max(selectionQuantity(input.addOns?.petFurVacuum), selectionQuantity(input.addOns?.pets)), rate("petFurVacuum"), "Heavy vacuum to remove pet fur per hour");
  addFlatCharge(input.addOns?.moveFurniture, rate("moveFurniture"), "Move furniture per hour");
  addFlatCharge(input.addOns?.ceilingFans, rate("ceilingFans"), "Ceiling fan");
  addFlatCharge(input.addOns?.travelDistance, rate("travelDistance"), "Travel distance 30 minute interval");
  addFlatCharge(input.addOns?.ceilingWash, rate("ceilingWash"), "Ceiling wash per room");
  addFlatCharge(input.addOns?.smallWindowPanels, rate("smallWindowPanels"), "Small window panel");
  addFlatCharge(input.addOns?.largeWindowPanels, rate("largeWindowPanels"), "Large window panel");
  addFlatCharge(input.addOns?.stairsMachineAccess, rate("stairsMachineAccess"), "Machine stair access level");
  addFlatCharge(input.addOns?.rug, rate("rug"), "Rug unit");
  addFlatCharge(input.addOns?.singleDoubleMattress, rate("singleDoubleMattress"), "Single / double mattress");
  addFlatCharge(input.addOns?.queenKingMattress, rate("queenKingMattress"), "Queen / king mattress");
  addFlatCharge(input.addOns?.bedFrames, rate("bedFrames"), "Bed frame");

  if (input.serviceType === "PRESSURE_WASH") {
    const areaSqm = Math.max(1, Number(input.areaSqm ?? AREA_SQM_FALLBACKS[input.areaBand ?? "standard"]));
    const amount = rate("waterPressureWash");
    const total = areaSqm * amount;
    addOnTotal += total;
    lineItems.push({ label: "Water pressure wash area", unitPrice: amount, qty: areaSqm, total });
  } else {
    addFlatCharge(input.addOns?.outdoorArea, rate("waterPressureWash"), "Water pressure wash per sqm");
  }

  return addOnTotal;
}

function addRoomPackage(
  input: QuoteInput,
  lineItems: QuoteResult["lineItems"],
  packageRate: BlueCleanRoomPackagePricing
) {
  let baseRate = Number(packageRate.base ?? 0);
  if (baseRate > 0) {
    lineItems.push({ label: `${packageRate.label} base`, unitPrice: baseRate, qty: 1, total: baseRate });
  }

  const bedroomRates = packageRate.bedrooms.length > 0 ? packageRate.bedrooms : [0];
  const bedrooms = Math.max(0, Math.min(input.bedrooms ?? 0, bedroomRates.length - 1));
  const bedroomPrice = Number(bedroomRates[bedrooms] ?? bedroomRates[bedroomRates.length - 1] ?? 0);
  baseRate += bedroomPrice;
  lineItems.push({ label: `${packageRate.label} - ${bedrooms === 0 ? "studio / no bedroom" : `${bedrooms} bedroom${bedrooms === 1 ? "" : "s"}`}`, unitPrice: bedroomPrice, qty: 1, total: bedroomPrice });

  const bathrooms = Math.max(0, input.bathrooms ?? 0);
  const bathroomRate = Number(packageRate.bathroomRate ?? 0);
  const bathroomTotal = Number((bathrooms * bathroomRate).toFixed(2));
  if (bathroomTotal > 0) {
    baseRate += bathroomTotal;
    lineItems.push({ label: "Bathrooms", unitPrice: bathroomRate, qty: bathrooms, total: bathroomTotal });
  }

  const floors = Math.max(1, input.floors ?? 1);
  const storyRates = packageRate.stories ?? [];
  const storyPrice = storyRates.length > 0
    ? Number(storyRates[Math.min(floors, storyRates.length) - 1] ?? storyRates[storyRates.length - 1] ?? 0)
    : floors * Number(packageRate.storyRate ?? 0);
  if (storyPrice > 0) {
    baseRate += storyPrice;
    lineItems.push({ label: "Stories", unitPrice: storyPrice, qty: 1, total: storyPrice });
  }

  return baseRate;
}

async function calculateBlueCleanStyleQuote(
  input: QuoteInput,
  gstSettings: GstSettings,
  quotePricing: BlueCleanQuotePricingSettings
): Promise<QuoteResult> {
  const lineItems: QuoteResult["lineItems"] = [];
  let baseRate = 0;

  switch (input.serviceType) {
    case "GENERAL_CLEAN":
      baseRate = addRoomPackage(input, lineItems, quotePricing.roomPackages.regularHouse);
      break;
    case "AIRBNB_TURNOVER":
      baseRate = addRoomPackage(input, lineItems, quotePricing.roomPackages.accommodation);
      break;
    case "DEEP_CLEAN":
    case "SPRING_CLEANING":
    case "SPECIAL_CLEAN":
      baseRate = addRoomPackage(input, lineItems, quotePricing.roomPackages.deepHouse);
      break;
    case "END_OF_LEASE":
      baseRate = addRoomPackage(input, lineItems, quotePricing.roomPackages.endOfLease);
      break;
    case "POST_CONSTRUCTION":
      baseRate = addRoomPackage(input, lineItems, quotePricing.roomPackages.postRenovation);
      break;
    case "CARPET_STEAM_CLEAN": {
      const rooms = Math.max(0, Number(input.serviceUnits ?? input.bedrooms ?? 0));
      const roomRanges = quotePricing.specialtyRates.carpetRoomRanges.length > 0 ? quotePricing.specialtyRates.carpetRoomRanges : [0];
      const roomTotal = Number(roomRanges[Math.min(rooms, roomRanges.length - 1)] ?? roomRanges[roomRanges.length - 1] ?? 0);
      const carpetSteamBase = Number(quotePricing.specialtyRates.carpetSteamBase ?? 0);
      baseRate = carpetSteamBase + roomTotal;
      lineItems.push({ label: "Carpet steam clean base", unitPrice: carpetSteamBase, qty: 1, total: carpetSteamBase });
      if (roomTotal > 0) lineItems.push({ label: "Carpeted rooms", unitPrice: roomTotal, qty: 1, total: roomTotal });
      break;
    }
    case "UPHOLSTERY_CLEANING": {
      const seats = Math.max(1, Number(input.serviceUnits ?? 1));
      const upholsteryBase = Number(quotePricing.specialtyRates.upholsteryBase ?? 0);
      const upholsterySeatRate = Number(quotePricing.specialtyRates.upholsterySeatRate ?? 0);
      baseRate = upholsteryBase + seats * upholsterySeatRate;
      lineItems.push({ label: "Couch / lounge base", unitPrice: upholsteryBase, qty: 1, total: upholsteryBase });
      lineItems.push({ label: "Seaters", unitPrice: upholsterySeatRate, qty: seats, total: seats * upholsterySeatRate });
      break;
    }
    case "WINDOW_CLEAN": {
      const panels = Math.max(0, Number(input.windowCount ?? input.serviceUnits ?? 0));
      const windowBase = Number(quotePricing.specialtyRates.windowBase ?? 0);
      const windowPanelRate = Number(quotePricing.specialtyRates.windowPanelRate ?? 0);
      baseRate = windowBase + panels * windowPanelRate;
      lineItems.push({ label: "Windows cleaning base", unitPrice: windowBase, qty: 1, total: windowBase });
      if (panels > 0) lineItems.push({ label: "Window panels", unitPrice: windowPanelRate, qty: panels, total: panels * windowPanelRate });
      break;
    }
    case "PRESSURE_WASH":
      baseRate = 0;
      break;
    default:
      return calculateLocalMarketingQuote(input, gstSettings);
  }

  const addOnTotal = addBlueCleanExtras(input, lineItems, quotePricing.extraRates);
  const multiplier = FREQUENCY_MULTIPLIERS[input.frequency ?? "one_off"] ?? 1;
  return finalizeQuote({
    baseRate,
    addOnTotal,
    multiplier,
    lineItems,
    input,
    pricingMode: "exact",
    gstSettings,
  });
}

async function calculateLocalMarketingQuote(input: QuoteInput, gstSettings: GstSettings): Promise<QuoteResult> {
  const lineItems: QuoteResult["lineItems"] = [];
  let baseRate = 0;

  switch (input.serviceType) {
    case "SPRING_CLEANING":
    case "SPECIAL_CLEAN": {
      const bedrooms = Math.max(1, input.bedrooms ?? 2);
      const bathrooms = Math.max(1, input.bathrooms ?? 1);
      const isMoveIn = input.serviceType === "SPECIAL_CLEAN";
      const baseVisit = isMoveIn ? 220 : 130;
      const bedroomRate = isMoveIn ? 65 : 48;
      const bathroomRate = isMoveIn ? 55 : 38;
      lineItems.push({ label: isMoveIn ? "Move-in clean base visit" : "Spring clean base visit", unitPrice: baseVisit, qty: 1, total: baseVisit });
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
    gstSettings,
  });
}

export async function calculateQuote(input: QuoteInput): Promise<QuoteResult> {
  const settings = await getAppSettings();
  const gstSettings = settings.pricing;

  if (BLUE_CLEAN_STYLE_SERVICES.has(input.serviceType)) {
    return calculateBlueCleanStyleQuote(input, gstSettings, settings.pricing.blueCleanQuote);
  }

  if (!supportsDirectPriceBookQuery(input.serviceType)) {
    return calculateLocalMarketingQuote(input, gstSettings);
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
    return calculateLocalMarketingQuote(input, gstSettings);
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
      [...allRows]
        .filter(
          (row) =>
            (row.bedrooms ?? 0) <= (input.bedrooms ?? 0) &&
            (row.bathrooms ?? 0) <= (input.bathrooms ?? 0)
        )
        .sort(
          (left, right) =>
            (right.bedrooms ?? 0) - (left.bedrooms ?? 0) ||
            (right.bathrooms ?? 0) - (left.bathrooms ?? 0) ||
            Number(right.baseRate ?? 0) - Number(left.baseRate ?? 0)
        )[0] ??
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
  const maybeAddFlatCharge = (selection: boolean | number | undefined, key: string, label: string) => {
    const amount = Number(addOns[key] ?? 0);
    const qty = selectionQuantity(selection);
    if (qty <= 0 || amount <= 0) return;
    const total = qty * amount;
    addOnTotal += total;
    lineItems.push({ label, unitPrice: amount, qty, total });
  };

  maybeAddFlatCharge(input.addOns?.oven, "oven", "Oven clean");
  maybeAddFlatCharge(input.addOns?.fridge, "fridge", "Fridge clean");
  maybeAddFlatCharge(input.addOns?.fridgeFull, "fridgeFull", "Full fridge clean");
  maybeAddFlatCharge(input.addOns?.freezer, "freezer", "Freezer clean");
  maybeAddFlatCharge(input.hasBalcony, "balcony", "Balcony");
  maybeAddFlatCharge(input.addOns?.smallBalcony, "smallBalcony", "Small balcony");
  maybeAddFlatCharge(input.addOns?.largeBalcony, "largeBalcony", "Large balcony");
  maybeAddFlatCharge(input.addOns?.heavyMess, "heavyMess", "Heavy mess surcharge");
  maybeAddFlatCharge(input.addOns?.sameDay, "sameDay", "Priority turnaround surcharge");
  maybeAddFlatCharge(input.addOns?.furnished, "furnished", "Furnished property allowance");
  maybeAddFlatCharge(input.addOns?.pets, "pets", "Pets / pet hair allowance");
  maybeAddFlatCharge(input.addOns?.outdoorArea, "outdoorArea", "Outdoor area allowance");
  maybeAddFlatCharge(input.addOns?.largeKitchen, "largeKitchen", "Large kitchen allowance");
  maybeAddFlatCharge(input.addOns?.grill, "grill", "Grill clean");
  maybeAddFlatCharge(input.addOns?.rangehood, "rangehood", "Rangehood and filter clean");
  maybeAddFlatCharge(input.addOns?.dishwasher, "dishwasher", "Dishwasher clean");
  maybeAddFlatCharge(input.addOns?.insideCupboards, "insideCupboards", "Inside cupboards and drawers");
  maybeAddFlatCharge(input.addOns?.pantry, "pantry", "Pantry clean");
  maybeAddFlatCharge(input.addOns?.interiorWindows, "interiorWindows", "Interior windows and tracks");
  maybeAddFlatCharge(input.addOns?.exteriorWindows, "exteriorWindows", "Exterior windows");
  maybeAddFlatCharge(input.addOns?.slidingGlassDoor, "slidingGlassDoor", "Sliding glass door and tracks");
  maybeAddFlatCharge(input.addOns?.blindsShutters, "blindsShutters", "Blinds / shutters wet wipe");
  maybeAddFlatCharge(input.addOns?.wallSpotClean, "wallSpotClean", "Wall spot clean");
  maybeAddFlatCharge(input.addOns?.wallWashing, "wallWashing", "Wall washing");
  maybeAddFlatCharge(input.addOns?.ceilingFans, "ceilingFans", "Ceiling fan clean");
  maybeAddFlatCharge(input.addOns?.airConditionerVents, "airConditionerVents", "Air conditioner vent clean");
  maybeAddFlatCharge(input.addOns?.wardrobe, "wardrobe", "Wardrobe clean");
  maybeAddFlatCharge(input.addOns?.garage, "garage", "Garage sweep and tidy");
  maybeAddFlatCharge(input.addOns?.deckPatio, "deckPatio", "Deck / patio clean");
  maybeAddFlatCharge(input.addOns?.alfresco, "alfresco", "Alfresco area clean");
  maybeAddFlatCharge(input.addOns?.pergola, "pergola", "Pergola clean");
  maybeAddFlatCharge(input.addOns?.carpetSteam, "carpetSteam", "Carpet steam clean allowance");
  maybeAddFlatCharge(input.addOns?.changeBedsheets, "changeBedsheets", "Change bedsheets");
  maybeAddFlatCharge(input.addOns?.washDishes, "washDishes", "Wash dishes");
  maybeAddFlatCharge(input.addOns?.laundryLoad, "laundryLoad", "Laundry load / hang out");
  maybeAddFlatCharge(input.addOns?.laundryFold, "laundryFold", "Laundry fold");
  maybeAddFlatCharge(input.addOns?.laundryCloset, "laundryCloset", "Laundry closet clean");
  maybeAddFlatCharge(input.addOns?.rumpusRoom, "rumpusRoom", "Rumpus room clean");

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
    gstSettings,
  });
}
