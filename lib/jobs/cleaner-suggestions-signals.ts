/**
 * Two extra facts for a suggested cleaner, both PURE and both shown only when
 * the data behind them is real:
 *
 * Travel. A straight-line (great-circle, `haversine`) distance to the job's
 * property, from the best location actually known for the cleaner:
 *   1. their previous job that day (the latest job starting before this one,
 *      when both start times and that property's coordinates are stored);
 *   2. else their home coordinates saved on their account.
 * It needs the job's property coordinates too. The basis is always named
 * ("from Manly Loft (previous job)", "from home"). It is labelled straight
 * line: no drive time is estimated, so none is shown.
 *
 * QA score. The Quality hub's own cleaner figure (average authoritative review
 * score over its default 30-day Sydney period). Below `MIN_QA_REVIEWS`
 * reviewed cleans it is shown as "–" with the reason, never as a number.
 */
import { haversine } from "@/lib/gps/distance";

export type GeoPoint = { lat: number; lng: number };

export type TravelBasis = "previous_job" | "home";

export type SuggestionTravel = {
  km: number;
  basis: TravelBasis;
  /** "Manly Loft (previous job)" or "home". */
  fromLabel: string;
};

export type SuggestionQa = { score: number | null; reviewed: number; periodDays: number };

export const MIN_QA_REVIEWS = 3;

type TimedPlace = { propertyName: string; startTime: string | null; location?: GeoPoint | null };

export function isGeoPoint(value: { lat: number | null; lng: number | null } | null | undefined): value is GeoPoint {
  return Boolean(value && typeof value.lat === "number" && typeof value.lng === "number"
    && Number.isFinite(value.lat) && Number.isFinite(value.lng)
    && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180
    && !(value.lat === 0 && value.lng === 0));
}

function minutes(value: string | null): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

/** The latest other job that day starting before `startTime`, with a known location. */
export function previousJobThatDay(startTime: string | null, others: readonly TimedPlace[]): (TimedPlace & { location: GeoPoint }) | null {
  const start = minutes(startTime);
  if (start === null) return null;
  let best: (TimedPlace & { location: GeoPoint }) | null = null;
  let bestStart = -1;
  for (const other of others) {
    const otherStart = minutes(other.startTime);
    if (otherStart === null || otherStart >= start || !isGeoPoint(other.location ?? null)) continue;
    if (otherStart > bestStart) {
      best = { ...other, location: other.location as GeoPoint };
      bestStart = otherStart;
    }
  }
  return best;
}

export function travelForCandidate(input: {
  destination: GeoPoint | null | undefined;
  startTime: string | null;
  otherJobsThatDay: readonly TimedPlace[];
  home: GeoPoint | null | undefined;
}): SuggestionTravel | null {
  if (!isGeoPoint(input.destination ?? null)) return null;
  const destination = input.destination as GeoPoint;
  const previous = previousJobThatDay(input.startTime, input.otherJobsThatDay);
  if (previous) {
    return { km: kmBetween(previous.location, destination), basis: "previous_job", fromLabel: `${previous.propertyName} (previous job)` };
  }
  if (isGeoPoint(input.home ?? null)) {
    return { km: kmBetween(input.home as GeoPoint, destination), basis: "home", fromLabel: "home" };
  }
  return null;
}

function kmBetween(from: GeoPoint, to: GeoPoint): number {
  return Math.round(haversine(from.lat, from.lng, to.lat, to.lng) / 100) / 10;
}

export function travelReason(travel: SuggestionTravel | null): string | null {
  if (!travel) return null;
  return `${travel.km.toLocaleString("en-AU", { maximumFractionDigits: 1 })} km straight-line from ${travel.fromLabel}`;
}

export function qaReason(qa: SuggestionQa | null | undefined): string | null {
  if (!qa) return null;
  if (qa.score === null || qa.reviewed < MIN_QA_REVIEWS) {
    return `QA – (${qa.reviewed} reviewed clean${qa.reviewed === 1 ? "" : "s"} in ${qa.periodDays} days; needs ${MIN_QA_REVIEWS})`;
  }
  return `QA ${Math.round(qa.score)} (${qa.reviewed} reviewed, ${qa.periodDays} days)`;
}

/** The score used for ranking: null unless there is enough data to show it. */
export function rankableQa(qa: SuggestionQa | null | undefined): number | null {
  return qa && qa.score !== null && qa.reviewed >= MIN_QA_REVIEWS ? qa.score : null;
}
