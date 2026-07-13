/**
 * Client-requested add-ons — shared model + helpers.
 *
 * When a client asks for extra services from the public quote page, we capture
 * them as structured pending entries on `Quote.requestedAddOns` so the admin can
 * one-click price them into the quote and re-send. Catalog matches carry their
 * price + how-to instructions; free-text requests come in at price 0 for the
 * admin to fill.
 */
import { EXTRAS_BY_ID } from "@/lib/pricing/extras-catalog";

export type RequestedAddOn = {
  /** Catalog id when the request maps to a known extra; absent for free-text. */
  id?: string;
  label: string;
  /** Ex-GST price. Catalog default, or 0 for free-text the admin must price. */
  price: number;
  /** Optional note the client left with the request. */
  note?: string;
  /** ISO timestamp of when the client asked. */
  requestedAt?: string;
};

/** A line item as stored on Quote.lineItems. */
export type QuoteLineItem = { label: string; unitPrice: number; qty: number; total: number };

/** A META extra as stored in the notes [[META:{extras}]] block. */
export type MetaExtra = { id?: string; label: string; instructions?: string };

/** Case/space-insensitive key for de-duplicating requests by identity. */
function addOnKey(entry: { id?: string | null; label: string }): string {
  return entry.id ? `id:${entry.id}` : `label:${entry.label.trim().toLowerCase()}`;
}

/**
 * Resolve raw request items (catalog ids OR free-text labels) from the public
 * page into structured entries with a resolved label + price.
 */
export function resolveRequestedAddOnEntries(items: unknown, note?: string, requestedAt?: string): RequestedAddOn[] {
  if (!Array.isArray(items)) return [];
  const out: RequestedAddOn[] = [];
  const seen = new Set<string>();
  for (const raw of items.slice(0, 30)) {
    if (typeof raw !== "string") continue;
    const value = raw.trim().slice(0, 120);
    if (!value) continue;
    const catalog = EXTRAS_BY_ID[value];
    const entry: RequestedAddOn = catalog
      ? { id: catalog.id, label: catalog.label, price: catalog.price }
      : { label: value, price: 0 };
    if (note) entry.note = note;
    if (requestedAt) entry.requestedAt = requestedAt;
    const key = addOnKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Safely parse the requestedAddOns JSON column into a typed list. */
export function parseRequestedAddOns(raw: unknown): RequestedAddOn[] {
  if (!Array.isArray(raw)) return [];
  const out: RequestedAddOn[] = [];
  for (const item of raw) {
    const e = (item ?? {}) as Record<string, unknown>;
    const label = typeof e.label === "string" ? e.label.trim() : "";
    if (!label) continue;
    out.push({
      id: typeof e.id === "string" && e.id ? e.id : undefined,
      label: label.slice(0, 120),
      price: Number.isFinite(Number(e.price)) ? Math.max(0, Number(e.price)) : 0,
      note: typeof e.note === "string" && e.note.trim() ? e.note.trim().slice(0, 1000) : undefined,
      requestedAt: typeof e.requestedAt === "string" ? e.requestedAt : undefined,
    });
  }
  return out.slice(0, 60);
}

/** Merge new requests into an existing pending list, de-duplicating by identity. */
export function mergeRequestedAddOns(existing: RequestedAddOn[], incoming: RequestedAddOn[]): RequestedAddOn[] {
  const byKey = new Map<string, RequestedAddOn>();
  for (const e of existing) byKey.set(addOnKey(e), e);
  for (const e of incoming) {
    const key = addOnKey(e);
    // Newer request wins (keeps the latest note/timestamp) but never loses a price.
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...e, price: e.price || prev.price } : e);
  }
  return Array.from(byKey.values()).slice(0, 60);
}

/** Remove the given entries (by identity) from a pending list. */
export function removeRequestedAddOns(existing: RequestedAddOn[], toRemove: { id?: string; label: string }[]): RequestedAddOn[] {
  const remove = new Set(toRemove.map((e) => addOnKey(e)));
  return existing.filter((e) => !remove.has(addOnKey(e)));
}

const META_REGEX = /\[\[META:([\s\S]+?)\]\]/;

/**
 * Add extras into the notes [[META:{extras,checklist}]] block, preserving the
 * human-readable notes and the existing checklist override. Catalog instructions
 * are attached by id so the extra flows into the cleaner's job form. De-dupes
 * against extras already present.
 */
export function addExtrasToNotesMeta(notes: string | null | undefined, extras: RequestedAddOn[]): string {
  const raw = notes ?? "";
  const match = raw.match(META_REGEX);
  const human = (match ? raw.replace(META_REGEX, "") : raw).trim();

  let meta: { extras?: MetaExtra[]; checklist?: unknown } = {};
  if (match) {
    try {
      meta = JSON.parse(match[1]);
    } catch {
      meta = {};
    }
  }
  const existingExtras: MetaExtra[] = Array.isArray(meta.extras) ? meta.extras : [];
  const seen = new Set(existingExtras.map((e) => addOnKey({ id: e.id, label: e.label })));
  const merged = [...existingExtras];
  for (const add of extras) {
    const key = addOnKey({ id: add.id, label: add.label });
    if (seen.has(key)) continue;
    seen.add(key);
    const instructions = add.id ? EXTRAS_BY_ID[add.id]?.instructions : undefined;
    merged.push({ ...(add.id ? { id: add.id } : {}), label: add.label, ...(instructions ? { instructions } : {}) });
  }
  const nextMeta = { ...meta, extras: merged };
  const metaBlock = `[[META:${JSON.stringify(nextMeta)}]]`;
  return [human, metaBlock].filter(Boolean).join("\n");
}
