import { JobType } from "@prisma/client";

/**
 * Labour-hours matrix: total cleaner-hours for a job, as
 * base + per-bedroom + per-bathroom. Prices are derived from this × the
 * editable rack hourly rate, so changing the rack rate (or these hours)
 * regenerates the whole rate card while preserving the target margin.
 */
export const LABOUR_HOURS: Record<string, { label: string; base: number; perBed: number; perBath: number }> = {
  AIRBNB_TURNOVER: { label: "Airbnb turnover", base: 1.0, perBed: 0.3, perBath: 0.4 },
  GENERAL_CLEAN: { label: "Regular / general clean", base: 1.3, perBed: 0.35, perBath: 0.5 },
  SPRING_CLEANING: { label: "Spring clean", base: 2.0, perBed: 0.6, perBath: 0.8 },
  DEEP_CLEAN: { label: "Deep clean", base: 2.5, perBed: 0.7, perBath: 1.0 },
  END_OF_LEASE: { label: "End of lease / bond", base: 3.5, perBed: 0.9, perBath: 1.4 },
  MOVE_IN_CLEAN: { label: "Move-in clean", base: 3.0, perBed: 0.8, perBath: 1.2 },
};

export const RATE_CARD_JOB_TYPES = Object.keys(LABOUR_HOURS) as JobType[];
export const RATE_CARD_BEDROOMS = [1, 2, 3, 4, 5];
export const RATE_CARD_BATHROOMS = [1, 2, 3];
export const MIN_JOB_CHARGE = 120;

export function estimateLabourHours(jobType: string, bedrooms: number, bathrooms: number): number {
  const m = LABOUR_HOURS[jobType];
  if (!m) return 0;
  return Number((m.base + m.perBed * bedrooms + m.perBath * bathrooms).toFixed(2));
}

/** Per-job price = hours × rack rate, rounded to $5, never below the minimum charge. */
export function priceForHours(hours: number, rackHourlyRate: number, minCharge = MIN_JOB_CHARGE): number {
  const raw = hours * rackHourlyRate;
  const rounded = Math.round(raw / 5) * 5;
  return Math.max(minCharge, rounded);
}

export interface RateCardRow {
  jobType: JobType;
  label: string;
  bedrooms: number;
  bathrooms: number;
  hours: number;
  baseRate: number;
}

/** Compute the full rate card (every service × size combination) from the rack rate. */
export function computeRateCard(rackHourlyRate: number, minCharge = MIN_JOB_CHARGE): RateCardRow[] {
  const rows: RateCardRow[] = [];
  for (const jobType of RATE_CARD_JOB_TYPES) {
    const m = LABOUR_HOURS[jobType];
    for (const bedrooms of RATE_CARD_BEDROOMS) {
      for (const bathrooms of RATE_CARD_BATHROOMS) {
        const hours = estimateLabourHours(jobType, bedrooms, bathrooms);
        rows.push({
          jobType,
          label: m.label,
          bedrooms,
          bathrooms,
          hours,
          baseRate: priceForHours(hours, rackHourlyRate, minCharge),
        });
      }
    }
  }
  return rows;
}

/** Gross margin (%) implied by a price given the cleaner hourly cost + labour hours. */
export function impliedMargin(price: number, hours: number, cleanerHourlyCost: number): number | null {
  if (price <= 0) return null;
  const cost = hours * cleanerHourlyCost;
  return Number((((price - cost) / price) * 100).toFixed(1));
}
