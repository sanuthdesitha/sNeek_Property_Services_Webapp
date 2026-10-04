/**
 * Who is arriving AFTER this clean.
 *
 * A turnover job is linked to the reservation whose CHECKOUT triggered it
 * (`lib/ical/sync.ts` sets `reservationId` from the booking whose `endDate` is
 * the turnover date), so `Job.reservation` is the guest who just LEFT. Reading
 * it as "the booking for this job" put the previous guest on the job detail.
 *
 * The arriving guest is a different reservation entirely, and the iCal sync
 * already captured it onto the job as `jobMeta.reservationContext` (that same
 * file builds it from `incomingCheckin`). This module turns that context into
 * the handful of fields worth showing, so admin and cleaner render the same
 * facts the same way.
 *
 * PURE: no DB, no clock, and no locale date formatting (callers own display),
 * so it is unit-testable.
 */

import type { JobReservationContext } from "./meta";
import { stayNights } from "@/lib/inventory/stay-preparation-policy";

export interface GuestSummary {
  stayNights?: number | null;
  /** Display name, or null when the feed gave none. */
  name: string | null;
  /** Full origin text as supplied, e.g. "Sydney, Australia". */
  origin: string | null;
  /** Best-effort country: the last comma-separated part of the origin. */
  country: string | null;
  /** Digits-and-plus only, safe for a tel: href. Null when unusable. */
  phone: string | null;
  /** Human-readable phone exactly as supplied. */
  phoneLabel: string | null;
  email: string | null;
  profileUrl: string | null;
  reservationCode: string | null;
  /** ISO string for the arrival, or null. Callers format it. */
  checkinAtLocal: string | null;
  /** "2 adults · 1 child", or null when the feed gave no counts. */
  guestCountLabel: string | null;
  /** How many people to prepare for, when known. */
  preparationGuestCount: number | null;
  /** True when the count is a property fallback rather than the real booking. */
  preparationIsFallback: boolean;
  /** False when there is nothing worth rendering at all. */
  hasAnything: boolean;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Airbnb-style feeds put the guest's location in one free-text field, most
 * often "City, Country" but sometimes just "Country" or a longer path. Take the
 * last comma-separated segment as the country rather than guessing harder — a
 * wrong country is worse than showing the whole string, which we also keep.
 */
export function extractCountry(locationText?: string | null): string | null {
  const text = cleanText(locationText);
  if (!text) return null;
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts[parts.length - 1];
}

/** Strip everything a tel: href cannot use, keeping a single leading +. */
export function telHref(phone?: string | null): string | null {
  const text = cleanText(phone);
  if (!text) return null;
  const hasPlus = text.startsWith("+");
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length < 6) return null;
  return `${hasPlus ? "+" : ""}${digits}`;
}

export function buildGuestCountLabel(input: {
  adults?: number | null;
  children?: number | null;
  infants?: number | null;
}): string | null {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (input.adults != null && input.adults > 0) parts.push(plural(input.adults, "adult", "adults"));
  if (input.children != null && input.children > 0) parts.push(plural(input.children, "child", "children"));
  if (input.infants != null && input.infants > 0) parts.push(plural(input.infants, "infant", "infants"));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Read-only cleaner preparation projection; never persist this over booking data. */
export function cleanerPreparationContext(
  context: JobReservationContext | null | undefined,
  job: { sameDayCheckin?: boolean | null; property: { name?: string | null; accessInfo?: unknown } },
): JobReservationContext {
  const ctx = context ?? {};
  const positiveCount = (value: unknown): number | undefined => {
    const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const actualCount = ctx.preparationSource !== "PROPERTY_MAX"
    ? positiveCount(ctx.preparationGuestCount) ?? positiveCount(
        (ctx.adults ?? 0) + (ctx.children ?? 0) + (ctx.infants ?? 0),
      )
    : undefined;
  if (job.sameDayCheckin && actualCount != null) {
    return { ...ctx, preparationGuestCount: actualCount, preparationSource: "INCOMING_BOOKING" };
  }
  // Require the Jackson name, not a bare P-number belonging to another client.
  const jackson = /^Jackson[\s_-]*(?:Property|P)[\s_-]*0*([1-9]\d*)$/i.exec(job.property.name?.trim() ?? "");
  const access = job.property.accessInfo;
  const configuredMax = access && typeof access === "object" && "maxGuestCount" in access
    ? positiveCount(access.maxGuestCount) : undefined;
  const number = jackson ? Number(jackson[1]) : null;
  const maximum = number != null
    ? number === 3 || number === 9 ? 4 : number === 11 ? 7 : 6
    : configuredMax ?? (ctx.preparationSource === "PROPERTY_MAX" ? positiveCount(ctx.preparationGuestCount) : undefined);
  return {
    ...ctx,
    adults: undefined, children: undefined, infants: undefined,
    preparationGuestCount: maximum,
    preparationSource: maximum != null ? "PROPERTY_MAX" : undefined,
  };
}

export function buildGuestSummary(context?: JobReservationContext | null): GuestSummary {
  const ctx = context ?? {};
  const origin = cleanText(ctx.locationText);
  const phoneLabel = cleanText(ctx.guestPhone);
  const summary: GuestSummary = {
    stayNights: stayNights(ctx),
    name: cleanText(ctx.guestName),
    origin,
    country: extractCountry(origin),
    phone: telHref(phoneLabel),
    phoneLabel,
    email: cleanText(ctx.guestEmail),
    profileUrl: cleanText(ctx.guestProfileUrl),
    reservationCode: cleanText(ctx.reservationCode),
    checkinAtLocal: cleanText(ctx.checkinAtLocal),
    guestCountLabel: buildGuestCountLabel(ctx),
    preparationGuestCount:
      typeof ctx.preparationGuestCount === "number" && ctx.preparationGuestCount > 0
        ? ctx.preparationGuestCount
        : null,
    preparationIsFallback: ctx.preparationSource === "PROPERTY_MAX",
    hasAnything: false,
  };

  summary.hasAnything = Boolean(
    summary.name ||
      summary.origin ||
      summary.phoneLabel ||
      summary.email ||
      summary.reservationCode ||
      summary.checkinAtLocal ||
      summary.guestCountLabel
  );
  return summary;
}

/**
 * What a CLEANER should see about the arriving guest: who, where from, when
 * they arrive, how many to prepare for, and a number to call. Deliberately not
 * the guest's email, profile link or reservation code — none of that helps
 * clean the property, and it is the guest's personal data.
 */
export function buildCleanerGuestSummary(context?: JobReservationContext | null): GuestSummary {
  const full = buildGuestSummary(context);
  const trimmed: GuestSummary = {
    ...full,
    email: null,
    profileUrl: null,
    reservationCode: null,
  };
  trimmed.hasAnything = Boolean(
    trimmed.name ||
      trimmed.origin ||
      trimmed.phoneLabel ||
      trimmed.checkinAtLocal ||
      trimmed.guestCountLabel ||
      trimmed.preparationGuestCount
  );
  return trimmed;
}
