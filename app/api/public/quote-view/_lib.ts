/**
 * Shared logic for the PUBLIC online quote experience (/q/<token> + the
 * /api/public/quote-view endpoints). Token-scoped, unauthenticated: everything
 * returned from here MUST be client-safe — no internal pricing config, margins,
 * cost rates, or other clients' data.
 */
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getChecklist } from "@/lib/checklists/store";
import { EXTRAS_BY_CATEGORY, EXTRAS_BY_ID } from "@/lib/pricing/extras-catalog";
import { publicUrl } from "@/lib/s3";

// ── Types ────────────────────────────────────────────────────────────────────

export type PublicLineItem = { label: string; qty: number; unitPrice: number; total: number };

export type PublicChecklist = {
  summary: string | null;
  included: string[];
  notIncluded: string[];
};

export type PublicAddOnOption = { id: string; label: string; price?: number };
export type PublicAddOnGroup = { id: string; label: string; options: PublicAddOnOption[] };

export type PublicQuotePayload = {
  company: { name: string; logoUrl: string };
  quoteRef: string;
  recipientFirstName: string;
  serviceLabel: string;
  status: "SENT" | "ACCEPTED" | "DECLINED" | "CONVERTED";
  createdAt: string;
  validUntil: string | null;
  expired: boolean;
  acceptedAt: string | null;
  declinedAt: string | null;
  lineItems: PublicLineItem[];
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  notes: string | null;
  checklist: PublicChecklist | null;
  chosenExtras: { label: string }[];
  showAddOnPrices: boolean;
  addOnCatalog: PublicAddOnGroup[];
  referenceImages: { url: string; label: string }[];
};

// ── META helpers (mirror lib/pricing/quote-report.ts) ────────────────────────

const META_REGEX = /\[\[META:([\s\S]+?)\]\]/;

type QuoteMetaExtras = { id?: string; label?: string; instructions?: string }[];
type QuoteMetaChecklist = {
  summary?: string;
  sections?: { title?: string; items?: { label?: string; covered?: boolean }[] }[];
  notCovered?: string[];
};

export function extractMetaAndNotes(notes: string | null | undefined): {
  meta: { extras?: QuoteMetaExtras; checklist?: QuoteMetaChecklist } | null;
  cleanNotes: string | null;
} {
  if (!notes) return { meta: null, cleanNotes: null };
  const match = notes.match(META_REGEX);
  if (!match) return { meta: null, cleanNotes: notes.trim() || null };
  let meta: { extras?: QuoteMetaExtras; checklist?: QuoteMetaChecklist } | null = null;
  try {
    meta = JSON.parse(match[1]);
  } catch {
    meta = null;
  }
  const cleanNotes = notes.replace(META_REGEX, "").trim() || null;
  return { meta, cleanNotes };
}

/**
 * Append a line to a quote's notes WITHOUT disturbing the [[META:...]] block.
 * The line goes into the human-readable part; the original META block (byte
 * identical) is re-appended at the end, matching how the builder writes it.
 */
export function appendNoteLinePreservingMeta(notes: string | null | undefined, line: string): string {
  const raw = notes ?? "";
  const match = raw.match(META_REGEX);
  const metaBlock = match ? match[0] : null;
  const human = (metaBlock ? raw.replace(META_REGEX, "") : raw).trim();
  const nextHuman = [human, line.trim()].filter(Boolean).join("\n");
  return metaBlock ? [nextHuman, metaBlock].filter(Boolean).join("\n") : nextHuman;
}

// ── Payload assembly ─────────────────────────────────────────────────────────

function toAbsoluteAssetUrl(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return "";
  if (/^(https?:|data:)/i.test(v)) return v;
  try {
    return publicUrl(v.replace(/^\/+/, ""));
  } catch {
    return v;
  }
}

function serviceTypeLabel(serviceType: string): string {
  return String(serviceType ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstName(full: string | null | undefined): string {
  const name = String(full ?? "").trim();
  if (!name) return "there";
  return name.split(/\s+/)[0];
}

function flattenChecklist(input: {
  summary?: string | null;
  sections?: { title?: string; items?: { label?: string; covered?: boolean }[] }[];
  notCovered?: string[];
}): PublicChecklist {
  const included: string[] = [];
  const notIncluded: string[] = [];
  for (const section of input.sections ?? []) {
    for (const item of section?.items ?? []) {
      const label = String(item?.label ?? "").trim();
      if (!label) continue;
      if (item?.covered === false) notIncluded.push(label);
      else included.push(label);
    }
  }
  for (const n of input.notCovered ?? []) {
    const label = String(n ?? "").trim();
    if (label) notIncluded.push(label);
  }
  return {
    summary: String(input.summary ?? "").trim() || null,
    included,
    notIncluded,
  };
}

export async function findQuoteByToken(token: string) {
  const clean = String(token ?? "").trim();
  // Tokens are opaque url-safe strings; reject junk before touching the DB.
  if (!clean || clean.length > 128 || !/^[A-Za-z0-9_-]+$/.test(clean)) return null;
  const quote = await db.quote.findUnique({
    where: { publicToken: clean },
    include: { lead: true, client: true },
  });
  if (!quote) return null;
  // A token should only exist once the quote is shared; never expose drafts.
  if (quote.status === "DRAFT") return null;
  return quote;
}

export function isQuoteExpired(quote: { validUntil: Date | null }): boolean {
  return Boolean(quote.validUntil && quote.validUntil.getTime() < Date.now());
}

export async function buildPublicQuotePayload(
  quote: NonNullable<Awaited<ReturnType<typeof findQuoteByToken>>>
): Promise<PublicQuotePayload> {
  const settings = await getAppSettings();
  const { meta, cleanNotes } = extractMetaAndNotes(quote.notes);

  // Checklist: per-quote META override wins, else the base service checklist.
  let checklist: PublicChecklist | null = null;
  if (meta?.checklist && Array.isArray(meta.checklist.sections)) {
    checklist = flattenChecklist(meta.checklist);
  } else {
    const base = await getChecklist(quote.serviceType as string).catch(() => null);
    if (base) checklist = flattenChecklist(base);
  }

  // Extras chosen on this quote — labels only, never internal pricing detail.
  const chosenExtras = (Array.isArray(meta?.extras) ? meta!.extras! : [])
    .map((e) => String(e?.label ?? "").trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((label) => ({ label }));

  // Full add-on catalog grouped by category. Prices are included ONLY when the
  // quote allows it — otherwise the price field is omitted entirely.
  const showAddOnPrices = Boolean(quote.showAddOnPrices);
  const addOnCatalog: PublicAddOnGroup[] = EXTRAS_BY_CATEGORY.map((group) => ({
    id: group.id,
    label: group.label,
    options: group.options.map((opt) =>
      showAddOnPrices
        ? { id: opt.id, label: opt.label, price: opt.price }
        : { id: opt.id, label: opt.label }
    ),
  }));

  const lineItems: PublicLineItem[] = (Array.isArray(quote.lineItems) ? (quote.lineItems as unknown[]) : [])
    .map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        label: String(item.label ?? "").slice(0, 300),
        qty: Number(item.qty) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        total: Number(item.total) || 0,
      };
    })
    .filter((i) => i.label);

  const referenceImages = (Array.isArray(quote.referenceImages) ? (quote.referenceImages as unknown[]) : [])
    .map((raw) => {
      const img = (raw ?? {}) as Record<string, unknown>;
      const url = toAbsoluteAssetUrl(img.url ?? img.key);
      return { url, label: String(img.label ?? "").slice(0, 200) };
    })
    .filter((i) => i.url)
    .slice(0, 30);

  return {
    company: {
      name: settings.companyName || "sNeek Property Services",
      logoUrl: toAbsoluteAssetUrl(settings.logoUrl),
    },
    quoteRef: String(quote.id).slice(-7).toUpperCase(),
    recipientFirstName: firstName(quote.client?.name ?? quote.lead?.name),
    serviceLabel: serviceTypeLabel(quote.serviceType as string),
    status: quote.status as PublicQuotePayload["status"],
    createdAt: quote.createdAt.toISOString(),
    validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
    expired: isQuoteExpired(quote),
    acceptedAt: quote.acceptedAt ? quote.acceptedAt.toISOString() : null,
    declinedAt: quote.declinedAt ? quote.declinedAt.toISOString() : null,
    lineItems,
    subtotal: Number(quote.subtotal) || 0,
    gstAmount: Number(quote.gstAmount) || 0,
    totalAmount: Number(quote.totalAmount) || 0,
    notes: cleanNotes,
    checklist,
    chosenExtras,
    showAddOnPrices,
    addOnCatalog,
    referenceImages,
  };
}

/** Stamp first-view time (best-effort; never blocks the response). */
export async function stampViewedAt(quoteId: string): Promise<void> {
  try {
    await db.quote.updateMany({
      where: { id: quoteId, viewedAt: null },
      data: { viewedAt: new Date() },
    });
  } catch {
    // best-effort only
  }
}

/** Resolve requested add-on entries (catalog ids or free-text labels) to display labels. */
export function resolveRequestedAddOns(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const labels: string[] = [];
  for (const raw of items.slice(0, 30)) {
    if (typeof raw !== "string") continue;
    const value = raw.trim().slice(0, 120);
    if (!value) continue;
    const catalog = EXTRAS_BY_ID[value];
    labels.push(catalog ? catalog.label : value);
  }
  // De-duplicate, preserving order.
  return Array.from(new Set(labels));
}
