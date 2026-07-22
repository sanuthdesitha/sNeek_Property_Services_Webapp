/**
 * Original-cleaner REWORK OFFER lifecycle (Phase 4 · Stage 1).
 *
 * When QA fails a clean it can OFFER the fix back to the cleaner who did it
 * ("come back and put it right, unpaid, no deduction") before reassigning it to
 * someone else at a cost. The offer lives on the `QaAssignment`:
 *
 *   reworkOfferStatus     NONE | OFFERED | ACCEPTED | DECLINED | EXPIRED
 *   reworkOfferedAt       when QA made the offer
 *   reworkOfferExpiresAt  now + settings.accountability.rectification.reworkOfferTtlMinutes
 *
 * There is no cron in this app, so expiry is enforced DEFENSIVELY ON READ:
 * `effectiveOfferStatus()` reports EXPIRED for any OFFERED row past its expiry,
 * and the respond route refuses to accept one. Persisting the EXPIRED value is a
 * best-effort side effect (`expireOfferPatch`), never a correctness requirement.
 *
 * Pure module — no DB import — so it is unit-testable and safe anywhere.
 */

export const REWORK_OFFER_STATUSES = ["NONE", "OFFERED", "ACCEPTED", "DECLINED", "EXPIRED"] as const;
export type ReworkOfferStatus = (typeof REWORK_OFFER_STATUSES)[number];

export const DEFAULT_REWORK_OFFER_TTL_MINUTES = 30;

export interface ReworkOfferShape {
  reworkOfferStatus?: string | null;
  reworkOfferedAt?: Date | string | null;
  reworkOfferExpiresAt?: Date | string | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function normalizeOfferStatus(value: unknown): ReworkOfferStatus {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (REWORK_OFFER_STATUSES as readonly string[]).includes(raw) ? (raw as ReworkOfferStatus) : "NONE";
}

/** Expiry TTL in ms, clamped to something sane. */
export function offerTtlMs(minutes: number | null | undefined): number {
  const n = Number(minutes);
  const safe = Number.isFinite(n) && n > 0 ? n : DEFAULT_REWORK_OFFER_TTL_MINUTES;
  return Math.min(Math.max(safe, 1), 24 * 60) * 60_000;
}

export function buildOfferWindow(now: Date, ttlMinutes: number | null | undefined) {
  return {
    reworkOfferStatus: "OFFERED" as const,
    reworkOfferedAt: now,
    reworkOfferExpiresAt: new Date(now.getTime() + offerTtlMs(ttlMinutes)),
  };
}

/**
 * The status the offer ACTUALLY has right now — an OFFERED row past its expiry
 * reads as EXPIRED even if nothing has written that back yet.
 */
export function effectiveOfferStatus(offer: ReworkOfferShape, now: Date = new Date()): ReworkOfferStatus {
  const status = normalizeOfferStatus(offer.reworkOfferStatus);
  if (status !== "OFFERED") return status;
  const expiresAt = toDate(offer.reworkOfferExpiresAt);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "OFFERED";
}

/** True when the cleaner may still accept/decline. */
export function isOfferOpen(offer: ReworkOfferShape, now: Date = new Date()): boolean {
  return effectiveOfferStatus(offer, now) === "OFFERED";
}

/** Minutes left on an open offer (null when not open). */
export function offerMinutesRemaining(offer: ReworkOfferShape, now: Date = new Date()): number | null {
  if (!isOfferOpen(offer, now)) return null;
  const expiresAt = toDate(offer.reworkOfferExpiresAt);
  if (!expiresAt) return null;
  return Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 60_000));
}

/** Patch to persist a lapsed offer (best-effort sweep on read). */
export function expireOfferPatch(offer: ReworkOfferShape, now: Date = new Date()) {
  return normalizeOfferStatus(offer.reworkOfferStatus) === "OFFERED" &&
    effectiveOfferStatus(offer, now) === "EXPIRED"
    ? { reworkOfferStatus: "EXPIRED" as const }
    : null;
}
