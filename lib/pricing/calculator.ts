import { db } from "@/lib/db";
import { JobType } from "@prisma/client";

interface QuoteInput {
  serviceType: JobType;
  bedrooms?: number;
  bathrooms?: number;
  hasBalcony?: boolean;
  addOns?: {
    oven?: boolean;
    fridge?: boolean;
    heavyMess?: boolean;
    sameDay?: boolean;
  };
  conditionLevel?: "light" | "standard" | "heavy";
}

interface QuoteResult {
  baseRate: number;
  addOnTotal: number;
  multiplier: number;
  subtotal: number;
  gst: number;
  total: number;
  lineItems: { label: string; unitPrice: number; qty: number; total: number }[];
  isEstimate: boolean;
  requiresAdminApproval: boolean;
  pricingMode: "exact" | "fallback";
}

export async function calculateQuote(input: QuoteInput): Promise<QuoteResult> {
  const exactEntry = await db.priceBook.findFirst({
    where: {
      jobType: input.serviceType,
      bedrooms: input.bedrooms ?? null,
      bathrooms: input.bathrooms ?? null,
      isActive: true,
    },
  });

  let entry = exactEntry;
  let pricingMode: QuoteResult["pricingMode"] = "exact";
  if (!entry) {
    const fallbackRows = await db.priceBook.findMany({
      where: {
        jobType: input.serviceType,
        isActive: true,
      },
      orderBy: [{ bedrooms: "asc" }, { bathrooms: "asc" }],
      take: 50,
    });

    entry =
      fallbackRows.find(
        (row) =>
          (row.bedrooms ?? 0) <= (input.bedrooms ?? 0) &&
          (row.bathrooms ?? 0) <= (input.bathrooms ?? 0)
      ) ??
      fallbackRows[0];

    if (entry) pricingMode = "fallback";
  }

  if (!entry) {
    const error = new Error(
      `No price book entry found for ${input.serviceType} ${input.bedrooms}bd/${input.bathrooms}ba`
    ) as Error & { code?: string };
    error.code = "NO_PRICEBOOK_MATCH";
    throw error;
  }

  const addOns = entry.addOns as Record<string, number>;
  const multipliers = entry.multipliers as Record<string, Record<string, number>>;

  const lineItems: QuoteResult["lineItems"] = [];
  let baseRate = entry.baseRate;
  lineItems.push({ label: "Base rate", unitPrice: entry.baseRate, qty: 1, total: entry.baseRate });

  const baseBedrooms = entry.bedrooms ?? 0;
  const baseBathrooms = entry.bathrooms ?? 0;
  const requestedBedrooms = input.bedrooms ?? baseBedrooms;
  const requestedBathrooms = input.bathrooms ?? baseBathrooms;

  const extraBedroomRate = Number(
    addOns.additionalBedroom ?? addOns.extraBedroom ?? addOns.perAdditionalBedroom ?? 0
  );
  const extraBathroomRate = Number(
    addOns.additionalBathroom ?? addOns.extraBathroom ?? addOns.perAdditionalBathroom ?? 0
  );
  const minPrice = Number(addOns.minimumPrice ?? addOns.minPrice ?? 0);

  const extraBedrooms = Math.max(0, requestedBedrooms - baseBedrooms);
  const extraBathrooms = Math.max(0, requestedBathrooms - baseBathrooms);
  if (extraBedrooms > 0 && extraBedroomRate > 0) {
    const total = extraBedrooms * extraBedroomRate;
    baseRate += total;
    lineItems.push({
      label: "Additional bedroom(s)",
      unitPrice: extraBedroomRate,
      qty: extraBedrooms,
      total,
    });
  }
  if (extraBathrooms > 0 && extraBathroomRate > 0) {
    const total = extraBathrooms * extraBathroomRate;
    baseRate += total;
    lineItems.push({
      label: "Additional bathroom(s)",
      unitPrice: extraBathroomRate,
      qty: extraBathrooms,
      total,
    });
  }

  let addOnTotal = 0;
  if (input.addOns?.oven && addOns.oven) {
    lineItems.push({ label: "Oven clean", unitPrice: addOns.oven, qty: 1, total: addOns.oven });
    addOnTotal += addOns.oven;
  }
  if (input.addOns?.fridge && addOns.fridge) {
    lineItems.push({ label: "Fridge clean", unitPrice: addOns.fridge, qty: 1, total: addOns.fridge });
    addOnTotal += addOns.fridge;
  }
  if (input.hasBalcony && addOns.balcony) {
    lineItems.push({ label: "Balcony", unitPrice: addOns.balcony, qty: 1, total: addOns.balcony });
    addOnTotal += addOns.balcony;
  }
  if (input.addOns?.heavyMess && addOns.heavyMess) {
    lineItems.push({ label: "Heavy mess surcharge", unitPrice: addOns.heavyMess, qty: 1, total: addOns.heavyMess });
    addOnTotal += addOns.heavyMess;
  }
  if (input.addOns?.sameDay && addOns.sameDay) {
    lineItems.push({ label: "Same-day surcharge", unitPrice: addOns.sameDay, qty: 1, total: addOns.sameDay });
    addOnTotal += addOns.sameDay;
  }

  const conditionLevel = input.conditionLevel ?? "standard";
  const multiplier = multipliers?.conditionLevel?.[conditionLevel] ?? 1;

  let subtotalBeforeGst = (baseRate + addOnTotal) * multiplier;
  if (minPrice > 0 && subtotalBeforeGst < minPrice) {
    const minAdj = Number((minPrice - subtotalBeforeGst).toFixed(2));
    lineItems.push({
      label: "Minimum service charge adjustment",
      unitPrice: minAdj,
      qty: 1,
      total: minAdj,
    });
    subtotalBeforeGst = minPrice;
  }
  const gst = subtotalBeforeGst * 0.1;
  const total = subtotalBeforeGst + gst;

  return {
    baseRate,
    addOnTotal,
    multiplier,
    subtotal: subtotalBeforeGst,
    gst,
    total,
    lineItems,
    isEstimate: true,
    requiresAdminApproval: true,
    pricingMode,
  };
}
