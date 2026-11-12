/**
 * Laundry partner portal entries (owner decision 2026-11-13). PURE and PLAIN
 * (no "use client"): shared by the server service, the portal screens, the
 * office run panel and tests.
 *
 * What a laundry login may add, all OPTIONAL (never required by any step):
 *  - weight (kg) and/or price for a run that is at the laundry (picked up or
 *    ready to return, before drop-off). The price is the partner's stated cost
 *    for the run and is stored where laundry cost is stored today
 *    (`LaundryTask.dropoffCostAud`); it changes no issued or paid invoice and
 *    no client charge. The office corrects it as today.
 *  - photo(s) added to a finished drop-off (DROPPED). Append only: every photo
 *    is its own confirmation row; nothing earlier is replaced.
 *  - "Ready to return" on a run that is picked up.
 *
 * Each entry is a LaundryConfirmation event (`notes.event`), the run's audit
 * trail, plus an AuditLog row.
 */
import { z } from "zod";

export const PARTNER_WEIGHT_PRICE_EVENT = "PARTNER_WEIGHT_PRICE";
export const DROPOFF_PHOTO_ADDED_EVENT = "DROPOFF_PHOTO_ADDED";
export const READY_TO_RETURN_EVENT = "READY_TO_RETURN";

export const MAX_ADDED_DROPOFF_PHOTOS = 4;

export const partnerWeightPriceSchema = z
  .object({
    weightKg: z.number().positive("Weight must be more than 0 kg.").max(500, "Weight must be 500 kg or less.").optional(),
    price: z.number().positive("Price must be more than $0.").max(100_000, "Price must be $100,000 or less.").optional(),
    note: z.string().trim().max(500).optional(),
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict()
  .refine((value) => value.weightKg !== undefined || value.price !== undefined, { message: "Enter a weight, a price, or both." });

export type PartnerWeightPriceInput = z.infer<typeof partnerWeightPriceSchema>;

export const dropoffPhotoAddSchema = z
  .object({
    photoKeys: z.array(z.string().trim().min(1).max(1000)).min(1, "Add at least one photo.").max(MAX_ADDED_DROPOFF_PHOTOS),
    note: z.string().trim().max(500).optional(),
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict();

export type DropoffPhotoAddInput = z.infer<typeof dropoffPhotoAddSchema>;

export const readyToReturnSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict();

export type ReadyToReturnInput = z.infer<typeof readyToReturnSchema>;

/** Statuses at which weight / price may be added (at the laundry, before drop-off). */
export const WEIGHT_PRICE_STATUSES: readonly string[] = ["PICKED_UP", "READY_TO_RETURN"];

export function canAddWeightPrice(status: string): boolean {
  return WEIGHT_PRICE_STATUSES.includes(status);
}

export function canAddDropoffPhoto(status: string): boolean {
  return status === "DROPPED";
}

export function canMarkReadyToReturn(status: string): boolean {
  return status === "PICKED_UP";
}

/**
 * The partner rule on top of the laundry visibility rule: a laundry login that
 * belongs to a partner may not write to a run another partner holds. A run
 * with no partner recorded, or a login not linked to a partner, falls back to
 * the visibility rule alone (as the other portal actions do).
 */
export function partnerMayWriteRun(runSupplierId: string | null | undefined, userSupplierId: string | null | undefined): boolean {
  if (!runSupplierId || !userSupplierId) return true;
  return runSupplierId === userSupplierId;
}

// ── "Entered by" on the office run panel ────────────────────────────────────

export type CostConfirmation = {
  confirmedById?: string | null;
  confirmedByName?: string | null;
  notes?: string | null;
  createdAt?: string | Date | null;
};

export type PartnerCostEntry = { byName: string; at: string | null; price: boolean; weight: boolean };

function parseMeta(notes: string | null | undefined): Record<string, unknown> {
  if (!notes) return {};
  try {
    const parsed: unknown = JSON.parse(notes);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type Setter = { partner: boolean; value: number; row: CostConfirmation };

/** The price / weight each confirmation sets, if any (office and partner paths alike). */
function valuesSetBy(meta: Record<string, unknown>): { price: number | null; weight: number | null } {
  if (meta.event === "EDIT_COMPLETED") {
    const after = (meta.after ?? {}) as Record<string, unknown>;
    const changed = Array.isArray(meta.changedFields) ? meta.changedFields : [];
    return {
      price: changed.includes("totalPrice") ? finiteNumber(after.totalPrice) : null,
      weight: changed.includes("loadWeightKg") ? finiteNumber(after.loadWeightKg) : null,
    };
  }
  return { price: finiteNumber(meta.totalPrice), weight: finiteNumber(meta.loadWeightKg ?? meta.weightKg) };
}

/**
 * Who entered the run's CURRENT price / weight, when it was a laundry partner
 * team member through the portal entry. Walks the confirmations in time order
 * and keeps the last event that set each value; the partner is named only when
 * that last setter is a partner entry AND its value is still the stored value
 * (an office correction through any path makes it the office's figure).
 */
export function partnerCostEntry(
  confirmations: readonly CostConfirmation[] | null | undefined,
  current: { dropoffCostAud?: number | null; bagWeightKg?: number | null },
): PartnerCostEntry | null {
  const rows = [...(confirmations ?? [])].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
  let price: Setter | null = null;
  let weight: Setter | null = null;
  for (const row of rows) {
    const meta = parseMeta(row.notes);
    const partner = meta.event === PARTNER_WEIGHT_PRICE_EVENT;
    const set = valuesSetBy(meta);
    // A later save that repeats the same figure (e.g. the office edit form
    // resending the stored price) does not take the entry over.
    if (set.price !== null && !(price && Math.abs(price.value - set.price) < 0.005)) price = { partner, value: set.price, row };
    if (set.weight !== null && !(weight && Math.abs(weight.value - set.weight) < 0.0005)) weight = { partner, value: set.weight, row };
  }
  const priceIsPartner = Boolean(price?.partner && current.dropoffCostAud != null && Math.abs(price.value - current.dropoffCostAud) < 0.005);
  const weightIsPartner = Boolean(weight?.partner && current.bagWeightKg != null && Math.abs(weight.value - current.bagWeightKg) < 0.0005);
  if (!priceIsPartner && !weightIsPartner) return null;
  const source = priceIsPartner ? price!.row : weight!.row;
  const at = source.createdAt ? new Date(source.createdAt).toISOString() : null;
  return { byName: source.confirmedByName?.trim() || "Laundry team member", at, price: priceIsPartner, weight: weightIsPartner };
}
