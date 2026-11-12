/**
 * Quote builder model: the pure helpers the builder has always used, moved
 * unchanged out of the old 2,300-line component (plain module, no React).
 * Seeding, per-unit hints and the checklist editing model live here.
 */
import { EXTRAS_BY_ID } from "@/lib/pricing/extras-catalog";
import type { PricingVariable } from "@/lib/pricing/variables";
import type { ServiceChecklist } from "@/lib/checklists/types";
import type { EPillTone } from "@/components/v2/ui/pill";
import type { QuoteEditSeed, QuoteLineItem, QuoteReferenceImage } from "@/lib/quotes/quote-record";

export type LineItem = QuoteLineItem;
export type ReferenceImage = QuoteReferenceImage;
export type CustomExtra = { id: string; label: string; price: number; instructions: string };
export type AppliedDiscount = { code: string | null; label: string; amount: number };
export type VariableLine = { label: string; amount: number };
export type RecipientMode = "client" | "lead" | "new";
export type NewLeadDraft = { name: string; email: string; phone: string; suburb: string };

/** Where the base lines came from, recorded in the notes META so it survives a reload. */
export type PricingSource = "rate-card" | "rate-card-edited" | "manual" | "unknown";

export const PRICING_SOURCE_BADGE: Record<PricingSource, { label: string; tone: EPillTone }> = {
  "rate-card": { label: "Priced from rate card", tone: "ok" },
  "rate-card-edited": { label: "Rate card, edited by hand", tone: "info" },
  manual: { label: "Manual quote", tone: "warn" },
  unknown: { label: "Pricing source not recorded", tone: "neutral" },
};

export interface ServiceOption {
  jobType: string;
  label: string;
  model: "ROOMS" | "AREA" | "WINDOWS" | "ITEMS" | "BANDS" | "HOURLY";
  itemLabel: string | null;
  unitLabel: string | null;
  bands: { label: string }[];
}

export interface PartyOption {
  id: string;
  name: string;
  email: string;
}
export type ClientOption = PartyOption & { suburb?: string | null };
export type LeadOption = PartyOption & {
  serviceType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  suburb?: string | null;
};

/** Sentinel select value for the "Other…" free-typed option (allowCustom). */
export const CUSTOM_OPTION = "__custom__";

/** Service recurrence options — persisted on the quote as `frequency`. */
export const FREQUENCY_OPTIONS = [
  { value: "one_off", label: "One-off" },
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
] as const;
export const FREQUENCY_VALUES = FREQUENCY_OPTIONS.map((o) => o.value) as readonly string[];

export const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

/** Human hint for how an option adjusts the price ("+20%", "+$25", ""). */
export function adjustHint(adjustType: string, adjustValue: number): string {
  if (adjustType === "none" || !adjustValue) return "";
  const sign = adjustValue > 0 ? "+" : "−";
  const abs = Math.abs(adjustValue);
  return adjustType === "percent" ? ` (${sign}${abs}%)` : ` (${sign}$${abs})`;
}

/** A number variable carrying a per-unit rate: the admin types how many units. */
export function isPerUnitVariable(v: PricingVariable): boolean {
  return v.kind === "number" && Boolean(v.unitAdjustValue);
}

/** A per-unit extra carries a "(per …)" suffix in its catalog label. */
export function isPerUnitExtra(label: string): boolean {
  return /\(\s*per\s+/i.test(label);
}

/** Live "$rate × qty = amount" preview for a per-unit quantity input. */
export function perUnitPreview(v: PricingVariable, qtyRaw: string): string {
  const rate = v.unitAdjustValue ?? 0;
  if (!rate) return "";
  const unit = v.unitLabel ? ` per ${v.unitLabel}` : " per unit";
  const qty = Number((qtyRaw ?? "").trim());
  if (v.unitAdjustType === "percent") {
    const base = `${rate > 0 ? "+" : "−"}${Math.abs(rate)}%${unit}`;
    return Number.isFinite(qty) && qty !== 0 ? `${base} · ${Math.abs(qty * rate)}% total` : base;
  }
  const base = `$${Math.abs(rate)}${unit}`;
  if (!Number.isFinite(qty) || qty === 0) return base;
  const amount = Math.round(qty * rate * 100) / 100;
  return `${base} · ${qty} × $${Math.abs(rate)} = $${amount.toFixed(2)}`;
}

// Editable per-quote checklist working model (seeded from the service default).
export type EditItem = { id: string; label: string; covered: boolean };
export type EditSection = { id: string; title: string; items: EditItem[] };
export type EditChecklist = { summary: string; sections: EditSection[]; notCovered: string[] };

let checklistUid = 0;
export const nextUid = () => `ck-${Date.now().toString(36)}-${(checklistUid++).toString(36)}`;

export function editableFromChecklist(c: ServiceChecklist): EditChecklist {
  return {
    summary: c.summary ?? "",
    sections: c.sections.map((s, si) => ({
      id: s.id || `sec-${si}`,
      title: s.title,
      items: s.items.map((it, ii) => ({ id: it.id || `it-${si}-${ii}`, label: it.label, covered: it.covered })),
    })),
    notCovered: [...(c.notCovered ?? [])],
  };
}

/** The parsed [[META:{…}]] block (free-form JSON written by the builder). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotesMeta = Record<string, any>;

export function parseNotesMeta(notes: string | null | undefined): NotesMeta | null {
  if (!notes) return null;
  const match = notes.match(/\[\[META:([\s\S]+?)\]\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as NotesMeta;
  } catch {
    return null;
  }
}

export function stripNotesMeta(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes.replace(/\[\[META:([\s\S]+?)\]\]/, "").trim();
}

type RawMetaItem = { label?: unknown; covered?: unknown };
type RawMetaSection = { title?: unknown; items?: unknown };

/** Rebuild the editable checklist model from a notes-META checklist override. */
export function editChecklistFromMeta(meta: NotesMeta | null): EditChecklist | null {
  const ov = meta?.checklist;
  if (!ov || !Array.isArray(ov.sections)) return null;
  const sections: EditSection[] = (ov.sections as RawMetaSection[]).map((s, si) => ({
    id: `sec-${si}`,
    title: typeof s?.title === "string" ? s.title : "",
    items: Array.isArray(s?.items)
      ? (s.items as RawMetaItem[])
          .filter((it) => typeof it?.label === "string" && it.label.trim())
          .map((it, ii) => ({ id: `it-${si}-${ii}`, label: String(it.label).trim(), covered: Boolean(it?.covered) }))
      : [],
  }));
  const notCovered = Array.isArray(ov.notCovered) ? ov.notCovered.filter((n: unknown): n is string => typeof n === "string") : [];
  return { summary: typeof ov.summary === "string" ? ov.summary : "", sections, notCovered };
}

const PRICING_SOURCES: readonly PricingSource[] = ["rate-card", "rate-card-edited", "manual"];

/** Compute every seedable piece of builder state from a stored quote. Pure; unchanged rules. */
export function buildEditSeed(editQuote: QuoteEditSeed, pricingVariables: PricingVariable[]) {
  const meta = parseNotesMeta(editQuote.notes);
  const bedrooms = meta?.bedrooms != null ? String(meta.bedrooms) : "2";
  const bathrooms = meta?.bathrooms != null ? String(meta.bathrooms) : "1";
  const sqm = meta?.sqm != null ? String(meta.sqm) : "50";

  const variableChoices: Record<string, string> = {};
  const variableCustom: Record<string, string> = {};
  const variableNumbers: Record<string, string> = {};
  const ctx = editQuote.serviceContext ?? {};
  for (const variable of pricingVariables) {
    const val = ctx[variable.id];
    if (variable.kind === "number") {
      if (val != null) variableNumbers[variable.id] = String(val);
      continue;
    }
    const options = variable.options ?? [];
    const fallback = variable.defaultOptionId ?? options[0]?.id ?? "";
    if (val == null) {
      if (fallback) variableChoices[variable.id] = fallback;
      continue;
    }
    if (options.some((o) => o.id === val)) variableChoices[variable.id] = String(val);
    else if (variable.allowCustom) {
      variableChoices[variable.id] = CUSTOM_OPTION;
      variableCustom[variable.id] = String(val);
    } else if (fallback) variableChoices[variable.id] = fallback;
  }

  // Extras were appended LAST in the stored lines, one per META.extras entry;
  // the discount is the negative-total line and is re-applied on save.
  const extrasMeta: NotesMeta[] = Array.isArray(meta?.extras) ? meta!.extras : [];
  const storedRaw = editQuote.lineItems ?? [];
  const discountLine = storedRaw.find((li) => Number(li?.total) < 0) ?? null;
  const seededDiscount: AppliedDiscount | null = discountLine
    ? { code: editQuote.discountCode ?? null, label: String(discountLine.label ?? "Discount"), amount: Math.abs(Number(discountLine.total) || 0) }
    : null;
  const stored = storedRaw.filter((li) => Number(li?.total) >= 0);
  const extraCount = Math.min(extrasMeta.length, stored.length);
  const extraSlice = extraCount > 0 ? stored.slice(stored.length - extraCount) : [];
  const baseLineItems = extraCount > 0 ? stored.slice(0, stored.length - extraCount) : stored.slice();

  const selectedExtras: string[] = [];
  const customExtras: CustomExtra[] = [];
  const extraQtys: Record<string, string> = {};
  extrasMeta.forEach((raw, i) => {
    const id = typeof raw?.id === "string" ? raw.id : "";
    const label = typeof raw?.label === "string" ? raw.label : "";
    const instructions = typeof raw?.instructions === "string" ? raw.instructions : "";
    const line = extraSlice[i];
    const price = line ? Number(line.unitPrice ?? line.total ?? 0) || 0 : 0;
    const qty = Number(line?.qty ?? raw?.qty ?? 1) || 1;
    const resolvedId = id && EXTRAS_BY_ID[id] ? id : id || `custom:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (isPerUnitExtra(label) && qty !== 1) extraQtys[resolvedId] = String(qty);
    if (id && EXTRAS_BY_ID[id]) selectedExtras.push(id);
    else if (id || label) customExtras.push({ id: resolvedId, label, price, instructions });
  });

  const recipientMode: RecipientMode = editQuote.clientId ? "client" : editQuote.leadId ? "lead" : "new";
  const pricingSource: PricingSource = PRICING_SOURCES.includes(meta?.pricingSource) ? meta!.pricingSource : "unknown";

  return {
    recipientMode,
    clientId: editQuote.clientId ?? "",
    leadId: editQuote.leadId ?? "",
    serviceType: editQuote.serviceType,
    frequency: editQuote.frequency && FREQUENCY_VALUES.includes(editQuote.frequency) ? editQuote.frequency : "one_off",
    serviceAddress: editQuote.serviceAddress ?? "",
    serviceSuburb: editQuote.serviceSuburb ?? "",
    bedrooms,
    bathrooms,
    sqm,
    variableChoices,
    variableCustom,
    variableNumbers,
    selectedExtras,
    customExtras,
    extraQtys,
    seededDiscount,
    lineItems: baseLineItems,
    refImages: editQuote.referenceImages ?? [],
    showAddOnPrices: Boolean(editQuote.showAddOnPrices),
    notes: stripNotesMeta(editQuote.notes),
    validUntilDate: editQuote.validUntil ? editQuote.validUntil.slice(0, 10) : "",
    editOverride: editChecklistFromMeta(meta),
    quoteHeading: typeof meta?.quoteHeading === "string" ? meta.quoteHeading : "",
    emailSubject: typeof meta?.emailSubject === "string" ? meta.emailSubject : "",
    emailMessage: typeof meta?.emailMessage === "string" ? meta.emailMessage : "",
    pricingSource,
  };
}

export type BuilderSeed = ReturnType<typeof buildEditSeed>;
