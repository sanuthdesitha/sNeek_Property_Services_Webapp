/**
 * Canonical money math for sNeek jobs — the SINGLE source of truth for two
 * numbers that must be identical on every screen:
 *
 *   1. computeCleanerPay  — what a cleaner is paid for a job.
 *   2. computeClientCharge — what the client is billed for a job.
 *
 * Every payroll run, cleaner invoice, cleaner dashboard, finance summary,
 * client invoice, client portal finance view, job detail, and the admin /
 * finance dashboards MUST import from here rather than re-deriving the numbers
 * inline. This is what guarantees the screens agree.
 *
 * These functions are pure and deterministic: pass in already-loaded rows and
 * settings, get back a rounded result. No I/O here — callers do the querying.
 *
 * NO schema changes were made for this module. It reads only existing fields:
 *   - Job.estimatedHours        → the job's allocated / fixed time (hours)
 *   - Job.fixedPrice            → agreed fixed CLIENT price for the job
 *   - Job.internalNotes (JSON)  → per-cleaner custom payout (cleanerPayouts map)
 *                                 and transport allowances (parsed via jobs/meta)
 *   - JobAssignment.payRate     → per-assignment hourly rate snapshot
 *   - User.hourlyRate           → cleaner default hourly rate
 *   - AppSettings.cleanerJobHourlyRates[cleanerId][jobType] → job-type rate
 *   - PropertyClientRate.baseCharge → property+job-type client rate
 *   - PriceBook.baseRate        → job-type client price (last-resort fallback)
 *   - CleanerPayAdjustment.approvedAmount → approved extras (added on top)
 */

import type { JobType } from "@prisma/client";
import { DEFAULT_CLEANER_HOURLY_RATE } from "@/lib/finance/pay-rates";

/** Round to whole cents. The one rounding rule used everywhere. */
export function roundCents(value: number): number {
  return Number((Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────
// Cleaner pay
// ─────────────────────────────────────────────────────────────────────────

export type CleanerPaySource = "CUSTOM" | "JOBTYPE_RATE";

export interface CleanerPayResult {
  /** Paid minutes for THIS cleaner (allocated time ÷ split). 0 when on timer fallback. */
  minutes: number;
  /** Paid hours for THIS cleaner (minutes / 60), the value shown on invoices. */
  hours: number;
  /** Effective hourly rate applied (default fallback when none configured). */
  rate: number;
  /** Base pay before adjustments/allowances: hours×rate, or the custom payout. */
  base: number;
  /** Sum of approved pay adjustments attributed to this cleaner for the job. */
  adjustments: number;
  /** Optional transport allowance for this cleaner (added on top, never split). */
  transportAllowance: number;
  /** base + adjustments + transportAllowance, rounded to cents. */
  total: number;
  /** Which rule produced `base`. */
  source: CleanerPaySource;
  /** True when no rate is configured anywhere AND there is no custom payout. */
  rateMissing: boolean;
  /** How `hours` was derived: ALLOCATED (estimatedHours) or TIMER (clocked). */
  payBasis: "ALLOCATED" | "TIMER";
  /** Number of active cleaners the allocated time was split across. */
  split: number;
}

export interface CleanerPayJob {
  jobType: JobType;
  /** Allocated/fixed time in hours (Job.estimatedHours). */
  estimatedHours: number | null;
}

export interface CleanerPayAssignmentInput {
  /** Per-assignment hourly rate snapshot (JobAssignment.payRate). */
  payRate?: number | null;
  /** Cleaner default hourly rate (User.hourlyRate). */
  userHourlyRate?: number | null;
}

export interface CleanerPaySettingsInput {
  /** settings.cleanerJobHourlyRates — per-cleaner, per-job-type hourly rate. */
  cleanerJobHourlyRates?: Record<string, Partial<Record<JobType, number>>>;
}

export interface CleanerPayContext {
  cleanerId: string;
  /** Active (non-removed) assignment count, for splitting allocated time. */
  activeAssignmentCount: number;
  /** Clocked timer hours for THIS cleaner (used only when no allocated time). */
  timerHours?: number;
  /**
   * Per-cleaner custom payout (jobMeta.cleanerPayouts[cleanerId]). When a finite
   * number, it REPLACES the computed hours×rate base for this cleaner. 0 is a
   * meaningful value ("pay nothing for this job").
   */
  customPayout?: number | null;
  /** Per-cleaner transport allowance (jobMeta.transportAllowances[cleanerId]). */
  transportAllowance?: number | null;
  /** Sum of approved CleanerPayAdjustment amounts for this cleaner on this job. */
  approvedAdjustments?: number;
  /**
   * Optional override of the paid hours (admin edits the hours on an invoice).
   * When provided and >= 0 it replaces the allocated/timer hours, but does NOT
   * apply to the custom-payout path (a custom payout is a flat amount).
   */
  hoursOverride?: number | null;
}

/**
 * Compute what a single cleaner is paid for a job.
 *
 * Rule (owner spec): pay = job's ALLOCATED time (estimatedHours, split equally
 * across active cleaners) × the JOB-TYPE pay rate — UNLESS a per-job custom
 * payout is set for this cleaner, in which case that flat amount is the base.
 * Approved pay adjustments and the transport allowance are added on top in both
 * cases. When no allocated time is set, fall back to the cleaner's clocked timer
 * hours (never fabricate hours). When no rate is configured anywhere, the shared
 * DEFAULT_CLEANER_HOURLY_RATE is used and `rateMissing` is flagged so the UI can
 * show a "rate not set" indicator instead of pretending the number is correct.
 */
export function computeCleanerPay(
  job: CleanerPayJob,
  assignment: CleanerPayAssignmentInput,
  settings: CleanerPaySettingsInput,
  context: CleanerPayContext
): CleanerPayResult {
  const split = Math.max(1, Math.floor(context.activeAssignmentCount || 1));

  const allocatedHours = Number(job.estimatedHours ?? 0);
  const hasAllocatedHours = Number.isFinite(allocatedHours) && allocatedHours > 0;
  const timerHours = Math.max(0, Number(context.timerHours ?? 0));
  const payBasis: "ALLOCATED" | "TIMER" = hasAllocatedHours ? "ALLOCATED" : "TIMER";

  const baseHours = hasAllocatedHours ? allocatedHours / split : timerHours;
  const overrideRaw = context.hoursOverride;
  const hasOverride =
    overrideRaw != null && Number.isFinite(Number(overrideRaw)) && Number(overrideRaw) >= 0;
  const paidHours = hasOverride ? Number(overrideRaw) : baseHours;

  // Resolve the hourly rate. Owner spec: the per-job-type rate OVERRIDES the
  // cleaner's personal default rate. Precedence (shared app-wide so screens
  // never disagree):
  //   1. assignment.payRate                       — explicit per-assignment
  //      snapshot (itself captured from the job-type rate at dispatch time)
  //   2. cleanerJobHourlyRates[cleaner][jobType]  — live per-cleaner job-type rate
  //   3. userHourlyRate (User.hourlyRate)         — cleaner's personal default
  const configuredRateRaw =
    assignment.payRate ??
    settings.cleanerJobHourlyRates?.[context.cleanerId]?.[job.jobType] ??
    assignment.userHourlyRate ??
    null;
  const configuredRate =
    configuredRateRaw != null && Number.isFinite(Number(configuredRateRaw)) && Number(configuredRateRaw) > 0
      ? Number(configuredRateRaw)
      : null;

  const customPayout = context.customPayout;
  const hasCustomPayout = typeof customPayout === "number" && Number.isFinite(customPayout);

  const rateMissing = configuredRate == null && !hasCustomPayout;
  const rate = configuredRate ?? DEFAULT_CLEANER_HOURLY_RATE;

  const base = hasCustomPayout ? roundCents(Number(customPayout)) : roundCents(paidHours * rate);

  const adjustments = roundCents(Math.max(0, Number(context.approvedAdjustments ?? 0)));
  const transportRaw = Number(context.transportAllowance ?? 0);
  const transportAllowance =
    Number.isFinite(transportRaw) && transportRaw > 0 ? roundCents(transportRaw) : 0;

  const total = roundCents(base + adjustments + transportAllowance);

  return {
    minutes: roundCents(paidHours * 60),
    hours: Number(paidHours.toFixed(2)),
    rate: roundCents(rate),
    base,
    adjustments,
    transportAllowance,
    total,
    source: hasCustomPayout ? "CUSTOM" : "JOBTYPE_RATE",
    rateMissing,
    payBasis,
    split: hasAllocatedHours ? split : 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Client charge
// ─────────────────────────────────────────────────────────────────────────

export type ClientChargeSource = "FIXED_JOB" | "PROPERTY_RATE" | "JOBTYPE_PRICE" | "MISSING";

export interface ClientChargeResult {
  /** Amount to bill the client for the job, or null when no source is configured. */
  amount: number | null;
  /** Which rule produced `amount` ("MISSING" when none). */
  source: ClientChargeSource;
  /** Convenience flag: true when no charge could be resolved. */
  rateMissing: boolean;
  /** Suggested invoice-line description from the matched rate, when available. */
  description: string | null;
}

export interface ClientChargeJob {
  jobType: JobType;
  propertyId: string;
  /** Agreed fixed CLIENT price for this job (Job.fixedPrice). Highest priority. */
  fixedPrice?: number | null;
}

export interface ClientChargeRateInput {
  propertyId: string;
  jobType: JobType;
  baseCharge: number;
  defaultDescription?: string | null;
}

export interface ClientChargePriceBookInput {
  jobType: JobType;
  baseRate: number;
}

export interface ClientChargeRates {
  /** Property+job-type rates (PropertyClientRate rows). */
  propertyRates?: ClientChargeRateInput[];
  /**
   * Job-type-level prices (PriceBook rows). Last-resort fallback when no fixed
   * price and no property rate exist. For a given job type the cheapest /
   * smallest configuration is used as the representative job-type price.
   */
  priceBook?: ClientChargePriceBookInput[];
}

/**
 * Compute what the client is billed for a job.
 *
 * Precedence (owner spec): a fixed/specific job amount wins; else the
 * property/client rate for the job type; else the job-type price book entry. If
 * none exist, return amount=null + source="MISSING" so the UI shows a clear
 * "rate not set" indicator instead of a fabricated markup. Never guess.
 */
export function computeClientCharge(
  job: ClientChargeJob,
  rates: ClientChargeRates,
  _settings?: unknown
): ClientChargeResult {
  const fixed = job.fixedPrice;
  // Require a POSITIVE fixed price. A stored 0 (or negative) is not a real
  // agreed price — treating it as FIXED_JOB billed the client $0 with
  // rateMissing:false, silently masking a missing rate. Fall through to the
  // property rate / price book instead (matches the price-book branch below,
  // which also requires > 0).
  if (fixed != null && Number.isFinite(Number(fixed)) && Number(fixed) > 0) {
    return {
      amount: roundCents(Number(fixed)),
      source: "FIXED_JOB",
      rateMissing: false,
      description: null,
    };
  }

  const propertyRate = (rates.propertyRates ?? []).find(
    (rate) => rate.propertyId === job.propertyId && rate.jobType === job.jobType
  );
  if (propertyRate && Number.isFinite(Number(propertyRate.baseCharge))) {
    return {
      amount: roundCents(Number(propertyRate.baseCharge)),
      source: "PROPERTY_RATE",
      rateMissing: false,
      description: propertyRate.defaultDescription?.trim() || null,
    };
  }

  const priceBookMatches = (rates.priceBook ?? []).filter(
    (entry) => entry.jobType === job.jobType && Number.isFinite(Number(entry.baseRate)) && Number(entry.baseRate) > 0
  );
  if (priceBookMatches.length > 0) {
    // Deterministic: use the lowest base rate for the job type as the
    // representative job-type price.
    const cheapest = priceBookMatches.reduce((min, entry) =>
      Number(entry.baseRate) < Number(min.baseRate) ? entry : min
    );
    return {
      amount: roundCents(Number(cheapest.baseRate)),
      source: "JOBTYPE_PRICE",
      rateMissing: false,
      description: null,
    };
  }

  return { amount: null, source: "MISSING", rateMissing: true, description: null };
}

/** Build the key used to look up a PropertyClientRate by property+job type. */
export function propertyRateKey(propertyId: string, jobType: JobType): string {
  return `${propertyId}:${jobType}`;
}
