/**
 * Quote builder arithmetic and request bodies, moved unchanged out of the old
 * builder component so they can be tested on their own. Plain module.
 *
 * Totals: the sum of lines through `calculateGstBreakdown` (the one GST rule),
 * a staged discount clamped to the subtotal and GST recomputed on the net — a
 * display estimate; the discount route finalises it on save.
 */
import { calculateGstBreakdown, type GstBreakdown } from "@/lib/pricing/gst";
import type { PricingSelections } from "@/lib/pricing/variables";
import { isPerUnitExtra, type AppliedDiscount, type EditChecklist, type LineItem, type NewLeadDraft, type PricingSource, type RecipientMode, type ReferenceImage, type ServiceOption } from "./model";

export type BuilderTotals = GstBreakdown & {
  discountAmount: number;
  /** After the staged discount (equals the base breakdown when there is none). */
  net: GstBreakdown;
};

export function builderTotals(lines: LineItem[], gstEnabled: boolean, stagedDiscount: number | null | undefined): BuilderTotals {
  const sum = lines.reduce((acc, li) => acc + (Number(li.total) || 0), 0);
  const base = calculateGstBreakdown(Math.max(0, Number(sum.toFixed(2))), { gstEnabled });
  const discountAmount = Math.min(base.subtotal, Math.max(0, stagedDiscount ?? 0));
  const net = calculateGstBreakdown(Math.max(0, Number((base.subtotal - discountAmount).toFixed(2))), { gstEnabled });
  return { ...base, discountAmount, net };
}

export type CouponCampaign = { code: string; title: string; discountType: string; discountValue: unknown };

/** The coupon amount the builder has always staged (FIXED clamped to the subtotal; percent of it). */
export function couponAmount(campaign: CouponCampaign, subtotal: number): number {
  return campaign.discountType === "FIXED"
    ? Math.min(subtotal, Math.max(0, Number(campaign.discountValue) || 0))
    : Number(((subtotal * Math.max(0, Math.min(100, Number(campaign.discountValue) || 0))) / 100).toFixed(2));
}

export type ExtraDetail = { id: string; label: string; price: number; instructions: string };

export type BuilderMetaInput = {
  model: ServiceOption["model"] | undefined;
  bedrooms: string;
  bathrooms: string;
  sqm: string;
  extras: ExtraDetail[];
  extraQty: (id: string) => number;
  checklistTouched: boolean;
  editChecklist: EditChecklist | null;
  quoteHeading: string;
  emailSubject: string;
  emailMessage: string;
  pricingSource: PricingSource;
};

export function buildQuoteMeta(input: BuilderMetaInput): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (input.model === "ROOMS") {
    base.bedrooms = Number(input.bedrooms) || 0;
    base.bathrooms = Number(input.bathrooms) || 0;
    if (Number(input.sqm) > 0) base.sqm = Number(input.sqm) || 0;
  } else if (input.model === "AREA") {
    base.sqm = Number(input.sqm) || 0;
  }
  base.extras = input.extras.map((e) => ({
    id: e.id,
    label: e.label,
    instructions: e.instructions,
    ...(isPerUnitExtra(e.label) ? { qty: input.extraQty(e.id) } : {}),
  }));
  if (input.checklistTouched && input.editChecklist) {
    base.checklist = {
      summary: input.editChecklist.summary.trim() || undefined,
      sections: input.editChecklist.sections.map((s) => ({
        title: s.title,
        items: s.items.filter((it) => it.label.trim()).map((it) => ({ label: it.label.trim(), covered: it.covered })),
      })),
      notCovered: input.editChecklist.notCovered.map((n) => n.trim()).filter(Boolean),
    };
  }
  const heading = input.quoteHeading.trim();
  if (heading) base.quoteHeading = heading;
  const subject = input.emailSubject.trim();
  if (subject) base.emailSubject = subject;
  const message = input.emailMessage.trim();
  if (message) base.emailMessage = message;
  // Provenance only (the badge on the page); no route prices from it.
  if (input.pricingSource !== "unknown") base.pricingSource = input.pricingSource;
  return base;
}

export type BuilderPayloadInput = {
  meta: Record<string, unknown>;
  notes: string;
  serviceContext: PricingSelections;
  refImages: ReferenceImage[];
  showAddOnPrices: boolean;
  recipientMode: RecipientMode;
  clientId: string;
  leadId: string;
  newLead: NewLeadDraft;
  serviceType: string;
  frequency: string;
  serviceAddress: string;
  serviceSuburb: string;
  lines: LineItem[];
  totals: GstBreakdown;
  validUntilDate: string;
  fromCaseId?: string;
};

function notesWithMeta(input: BuilderPayloadInput): string {
  return [input.notes.trim(), `[[META:${JSON.stringify(input.meta)}]]`].filter(Boolean).join("\n");
}

function referenceImagesBody(images: ReferenceImage[]) {
  return images.map((r) => ({ key: r.key, url: r.url, label: r.label?.trim() || undefined }));
}

function validUntilIso(date: string): string | null {
  return date ? new Date(`${date}T23:59:59`).toISOString() : null;
}

/** `POST /api/admin/quotes` body (create). */
export function buildCreatePayload(input: BuilderPayloadInput) {
  return {
    serviceContext: Object.keys(input.serviceContext).length > 0 ? input.serviceContext : undefined,
    referenceImages: input.refImages.length > 0 ? referenceImagesBody(input.refImages) : undefined,
    showAddOnPrices: input.showAddOnPrices,
    clientId: input.recipientMode === "client" ? input.clientId : undefined,
    leadId: input.recipientMode === "lead" ? input.leadId : undefined,
    newLead:
      input.recipientMode === "new"
        ? {
            name: input.newLead.name.trim(),
            email: input.newLead.email.trim(),
            phone: input.newLead.phone.trim() || undefined,
            suburb: input.newLead.suburb.trim() || undefined,
          }
        : undefined,
    serviceType: input.serviceType,
    frequency: input.frequency,
    serviceAddress: input.serviceAddress.trim() || undefined,
    serviceSuburb: input.serviceSuburb.trim() || undefined,
    lineItems: input.lines,
    subtotal: input.totals.subtotal,
    gstAmount: input.totals.gstAmount,
    totalAmount: input.totals.totalAmount,
    notes: notesWithMeta(input) || undefined,
    validUntil: validUntilIso(input.validUntilDate) ?? undefined,
    fromCaseId: input.fromCaseId,
  };
}

/** `PATCH /api/admin/quotes/[id]` body (edit). A saved quote's lead is not changed by this route. */
export function buildEditPatch(input: BuilderPayloadInput) {
  return {
    serviceType: input.serviceType,
    frequency: input.frequency,
    serviceAddress: input.serviceAddress.trim() || undefined,
    serviceSuburb: input.serviceSuburb.trim() || undefined,
    clientId: input.recipientMode === "client" ? input.clientId || null : null,
    lineItems: input.lines,
    subtotal: input.totals.subtotal,
    gstAmount: input.totals.gstAmount,
    totalAmount: input.totals.totalAmount,
    notes: notesWithMeta(input) || null,
    serviceContext: Object.keys(input.serviceContext).length > 0 ? input.serviceContext : null,
    referenceImages: input.refImages.length > 0 ? referenceImagesBody(input.refImages) : null,
    showAddOnPrices: input.showAddOnPrices,
    validUntil: validUntilIso(input.validUntilDate),
  };
}

/** The staged discount as a discount-route body (null = leave the saved discount alone). */
export function discountRequestBody(applied: AppliedDiscount | null, seededHadDiscount: boolean): Record<string, unknown> | null {
  if (applied?.code) return { code: applied.code };
  if (applied && applied.amount > 0) return { amount: applied.amount, label: applied.label.replace(/^Discount · /, "") };
  if (seededHadDiscount) return { clear: true };
  return null;
}
