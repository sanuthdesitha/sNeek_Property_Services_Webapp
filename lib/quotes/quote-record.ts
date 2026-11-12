/**
 * One stored quote, reshaped for the quote full page. Plain module: the
 * server page builds it from Prisma and the client rebuilds it from
 * `GET /api/admin/quotes/[id]` after a write, with the same rules the old
 * detail and edit pages each applied (so the builder seed is unchanged).
 */

export type QuoteLineItem = { label: string; unitPrice: number; qty: number; total: number };
export type QuoteReferenceImage = { key: string; url: string; label?: string };
export type QuoteRequestedAddOn = { id?: string; label: string; price: number; note?: string; requestedAt?: string };
export type QuoteParty = { id: string; name: string; email: string; address?: string | null; suburb?: string | null };

/** The stored quote reshaped for seeding the builder in edit mode. */
export interface QuoteEditSeed {
  id: string;
  status: string;
  serviceType: string;
  clientId: string | null;
  leadId: string | null;
  leadName?: string | null;
  /** Service recurrence — one of one_off | weekly | fortnightly | monthly. */
  frequency?: string | null;
  serviceAddress?: string | null;
  serviceSuburb?: string | null;
  serviceContext: Record<string, string | number | boolean> | null;
  referenceImages: QuoteReferenceImage[];
  showAddOnPrices: boolean;
  lineItems: QuoteLineItem[];
  /** Applied coupon code, if the quote carries a campaign discount. */
  discountCode?: string | null;
  /** Raw notes including any [[META:{…}]] block. */
  notes: string;
  /** ISO string or null. */
  validUntil: string | null;
}

export type QuoteSnapshot = {
  id: string;
  status: string;
  serviceType: string;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  notes: string;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
  clientId: string | null;
  leadId: string | null;
  client: QuoteParty | null;
  lead: QuoteParty | null;
  publicToken: string | null;
  showAddOnPrices: boolean;
  viewedAt: string | null;
  acceptedAt: string | null;
  convertedJobId: string | null;
  frequency: string | null;
  serviceAddress: string | null;
  serviceSuburb: string | null;
  referenceImages: QuoteReferenceImage[];
  serviceContext: Record<string, string | number | boolean> | null;
  requestedAddOns: QuoteRequestedAddOn[];
  lineItems: QuoteLineItem[];
  discountCode: string | null;
};

type DateLike = Date | string | null | undefined;
type PartyLike = { id: string; name: string; email?: string | null; address?: string | null; suburb?: string | null } | null | undefined;

/** The fields read from a stored quote (Prisma row on the server, JSON on the client). */
export type QuoteRecordInput = {
  id: string;
  status: unknown;
  serviceType: unknown;
  subtotal?: unknown;
  gstAmount?: unknown;
  totalAmount?: unknown;
  notes?: string | null;
  validUntil?: DateLike;
  createdAt?: DateLike;
  updatedAt?: DateLike;
  clientId?: string | null;
  leadId?: string | null;
  client?: PartyLike;
  lead?: PartyLike;
  publicToken?: string | null;
  showAddOnPrices?: boolean | null;
  viewedAt?: DateLike;
  acceptedAt?: DateLike;
  convertedJobId?: string | null;
  frequency?: string | null;
  serviceAddress?: string | null;
  serviceSuburb?: string | null;
  referenceImages?: unknown;
  serviceContext?: unknown;
  requestedAddOns?: unknown;
  lineItems?: unknown;
  discountCode?: string | null;
};

function iso(value: DateLike): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function party(value: PartyLike, fallback?: QuoteParty | null): QuoteParty | null {
  if (!value) return null;
  const known = fallback && fallback.id === value.id ? fallback : null;
  return {
    id: value.id,
    name: value.name,
    email: value.email ?? known?.email ?? "",
    address: value.address ?? known?.address ?? null,
    suburb: value.suburb ?? known?.suburb ?? null,
  };
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>).filter((entry) => entry && typeof entry === "object") : [];
}

export function referenceImagesFrom(value: unknown): QuoteReferenceImage[] {
  return records(value)
    .filter((entry) => typeof entry.url === "string")
    .map((entry) => ({
      key: typeof entry.key === "string" ? entry.key : String(entry.url),
      url: String(entry.url),
      label: typeof entry.label === "string" ? entry.label : undefined,
    }));
}

export function lineItemsFrom(value: unknown): QuoteLineItem[] {
  return records(value).map((entry) => ({
    label: typeof entry.label === "string" ? entry.label : "",
    unitPrice: Number(entry.unitPrice ?? 0),
    qty: Number(entry.qty ?? 0),
    total: Number(entry.total ?? 0),
  }));
}

export function requestedAddOnsFrom(value: unknown): QuoteRequestedAddOn[] {
  return records(value)
    .filter((entry) => typeof entry.label === "string")
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : undefined,
      label: String(entry.label),
      price: Number(entry.price) || 0,
      note: typeof entry.note === "string" ? entry.note : undefined,
      requestedAt: typeof entry.requestedAt === "string" ? entry.requestedAt : undefined,
    }));
}

function serviceContextFrom(value: unknown): Record<string, string | number | boolean> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string | number | boolean>) : null;
}

/** `fallbackParties` keeps a client's address when a JSON reload only carries id, name and email. */
export function snapshotFromRecord(record: QuoteRecordInput, fallbackParties?: { client: QuoteParty | null; lead: QuoteParty | null }): QuoteSnapshot {
  return {
    id: record.id,
    status: String(record.status),
    serviceType: String(record.serviceType),
    subtotal: Number(record.subtotal ?? 0),
    gstAmount: Number(record.gstAmount ?? 0),
    totalAmount: Number(record.totalAmount ?? 0),
    notes: record.notes ?? "",
    validUntil: iso(record.validUntil),
    createdAt: iso(record.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(record.updatedAt) ?? iso(record.createdAt) ?? new Date(0).toISOString(),
    clientId: record.clientId ?? null,
    leadId: record.leadId ?? null,
    client: party(record.client, fallbackParties?.client),
    lead: party(record.lead, fallbackParties?.lead),
    publicToken: record.publicToken ?? null,
    showAddOnPrices: Boolean(record.showAddOnPrices),
    viewedAt: iso(record.viewedAt),
    acceptedAt: iso(record.acceptedAt),
    convertedJobId: record.convertedJobId ?? null,
    frequency: record.frequency ?? null,
    serviceAddress: record.serviceAddress ?? null,
    serviceSuburb: record.serviceSuburb ?? null,
    referenceImages: referenceImagesFrom(record.referenceImages),
    serviceContext: serviceContextFrom(record.serviceContext),
    requestedAddOns: requestedAddOnsFrom(record.requestedAddOns),
    lineItems: lineItemsFrom(record.lineItems),
    discountCode: record.discountCode ?? null,
  };
}

/** Exactly the seed the old edit page built. */
export function editSeedFromSnapshot(snapshot: QuoteSnapshot): QuoteEditSeed {
  return {
    id: snapshot.id,
    status: snapshot.status,
    serviceType: snapshot.serviceType,
    frequency: snapshot.frequency,
    serviceAddress: snapshot.serviceAddress,
    serviceSuburb: snapshot.serviceSuburb,
    clientId: snapshot.clientId,
    leadId: snapshot.leadId,
    leadName: snapshot.lead?.name ?? null,
    serviceContext: snapshot.serviceContext,
    referenceImages: snapshot.referenceImages,
    showAddOnPrices: snapshot.showAddOnPrices,
    lineItems: snapshot.lineItems,
    discountCode: snapshot.discountCode,
    notes: snapshot.notes,
    validUntil: snapshot.validUntil,
  };
}

/** The [[META:{…}]] block of stored notes, verbatim (empty string when absent). */
export function notesMetaBlock(notes: string | null | undefined): string {
  const match = (notes ?? "").match(/\[\[META:([\s\S]+?)\]\]/);
  return match ? match[0] : "";
}

/** Notes prose with the META block removed. */
export function notesProse(notes: string | null | undefined): string {
  return (notes ?? "").replace(/\[\[META:([\s\S]+?)\]\]/, "").trim();
}
