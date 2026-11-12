import "server-only";
/**
 * Server reads for the quote full page (new and existing quote): the
 * builder's option lists (same queries the old new / edit pages ran), the
 * margin model as a cost share only (the rack rate and cleaner cost stay on
 * the server; the rate card is PIN-protected), and the stored quote.
 */
import { db } from "@/lib/db";
import type { getAppSettings } from "@/lib/settings";
import { SERVICE_CATALOG } from "@/lib/pricing/service-catalog";
import { snapshotFromRecord, type QuoteSnapshot } from "@/lib/quotes/quote-record";

type AppSettings = Awaited<ReturnType<typeof getAppSettings>>;

export type MarginModelData = { costShare: number; floorPercent: number } | null;

export function serviceOptions() {
  return SERVICE_CATALOG.map((c) => ({
    jobType: c.jobType as string,
    label: c.label,
    model: c.model,
    itemLabel: c.itemLabel ?? null,
    unitLabel: c.unitLabel ?? null,
    bands: (c.rate.bands ?? []).map((b) => ({ label: b.label })),
  }));
}

/** Same rule as `estimateMargin`: cost share = cleaner cost ÷ rack rate, capped at 95 %; null when not set. */
export function marginModelFrom(settings: AppSettings): MarginModelData {
  const pricing = (settings?.pricing ?? {}) as { rackHourlyRate?: number; cleanerHourlyCost?: number; marginFloorPercent?: number };
  const rack = Number(pricing.rackHourlyRate);
  const cost = Number(pricing.cleanerHourlyCost);
  if (!(rack > 0) || !(cost > 0)) return null;
  return { costShare: Math.min(0.95, cost / rack), floorPercent: Number(pricing.marginFloorPercent ?? 40) };
}

export function timezoneFrom(settings: AppSettings): string {
  const value = (settings as { timezone?: unknown } | null)?.timezone;
  return typeof value === "string" && value.trim() ? value : "Australia/Sydney";
}

export async function loadBuilderLists() {
  const [leads, clients] = await Promise.all([
    db.quoteLead.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true, email: true, suburb: true, serviceType: true, bedrooms: true, bathrooms: true, estimateMin: true, estimateMax: true },
    }),
    db.client.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true, email: true, suburb: true } }),
  ]);
  return {
    leads: leads.map((l) => ({ id: l.id, name: l.name, email: l.email ?? "", suburb: l.suburb ?? null, serviceType: l.serviceType ? String(l.serviceType) : null, bedrooms: l.bedrooms ?? null, bathrooms: l.bathrooms ?? null })),
    clients: clients.map((c) => ({ id: c.id, name: c.name, email: c.email ?? "", suburb: c.suburb ?? null })),
  };
}

export async function loadQuoteSnapshot(id: string): Promise<QuoteSnapshot | null> {
  const quote = await db.quote
    .findUnique({
      where: { id },
      select: {
        id: true, quoteNumber: true, status: true, serviceType: true, subtotal: true, gstAmount: true, totalAmount: true, notes: true, internalNotes: true, validUntil: true,
        createdAt: true, updatedAt: true, clientId: true, leadId: true, publicToken: true, showAddOnPrices: true, viewedAt: true,
        acceptedAt: true, convertedJobId: true, referenceImages: true, serviceContext: true, frequency: true, serviceAddress: true,
        serviceSuburb: true, requestedAddOns: true, discountCode: true, lineItems: true,
        client: { select: { id: true, name: true, email: true, address: true, suburb: true } },
        lead: { select: { id: true, name: true, email: true, address: true, suburb: true } },
      },
    })
    .catch(() => null);
  return quote ? snapshotFromRecord(quote) : null;
}
