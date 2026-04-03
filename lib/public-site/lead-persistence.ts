import { db } from "@/lib/db";
import { JobType } from "@prisma/client";

function shouldRetryWithoutExtendedColumns(error: unknown) {
  const message = String((error as any)?.message ?? "");
  return /requestedServiceLabel|structuredContext|promoCode|column|Unknown arg/i.test(message);
}

export async function createPublicQuoteLead(data: {
  serviceType: JobType;
  requestedServiceLabel: string;
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  suburb?: string | null;
  bedrooms?: number;
  bathrooms?: number;
  hasBalcony?: boolean;
  notes?: string;
  estimateMin?: number;
  estimateMax?: number;
  promoCode?: string;
  structuredContext?: Record<string, unknown>;
}) {
  const fullData = {
    serviceType: data.serviceType,
    requestedServiceLabel: data.requestedServiceLabel,
    name: data.name,
    email: data.email,
    phone: data.phone ?? null,
    address: data.address ?? null,
    suburb: data.suburb ?? null,
    bedrooms: data.bedrooms,
    bathrooms: data.bathrooms,
    hasBalcony: data.hasBalcony ?? false,
    notes: data.notes,
    estimateMin: data.estimateMin,
    estimateMax: data.estimateMax,
    promoCode: data.promoCode ?? null,
    structuredContext: data.structuredContext as any,
  };

  try {
    return await db.quoteLead.create({ data: fullData as any });
  } catch (error) {
    if (!shouldRetryWithoutExtendedColumns(error)) throw error;

    const fallbackNotes = [
      data.notes,
      `Requested service: ${data.requestedServiceLabel}`,
      data.promoCode ? `Promo code: ${data.promoCode}` : "",
      data.structuredContext ? `Website context: ${JSON.stringify(data.structuredContext)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return db.quoteLead.create({
      data: {
        serviceType: data.serviceType,
        name: data.name,
        email: data.email,
        phone: data.phone ?? null,
        address: data.address ?? null,
        suburb: data.suburb ?? null,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        hasBalcony: data.hasBalcony ?? false,
        notes: fallbackNotes,
        estimateMin: data.estimateMin,
        estimateMax: data.estimateMax,
      } as any,
    });
  }
}
