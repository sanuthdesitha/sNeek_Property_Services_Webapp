import "server-only";
import type { JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { computeClientCharge, type ClientChargeSource } from "@/lib/finance/job-money";
import { parseJobInternalNotes } from "./meta";

/**
 * The two derived columns of the Jobs table, computed on the server:
 *
 * - `guestIn`: the ARRIVING guest's check-in from `jobMeta.reservationContext`
 *   (the iCal sync's incoming booking), with the job's own `sameDayCheckin`
 *   flag. `Job.reservation` is the departing guest and is not used here.
 * - `charge`: the client charge from the canonical `computeClientCharge`
 *   (fixed price, then property rate, then price book). A missing rate stays
 *   `amount: null` with `missing: true`; it is never shown as 0.
 *
 * Returned only on the paginated list for administrators and operations
 * managers, who already receive `fixedPrice`; job-level billing follows Jobs
 * access in the operations catalog.
 */
export type JobGuestIn = {
  /** ISO instant of the arriving guest's check-in, when the booking gave one. */
  checkinAt: string | null;
  /** yyyy-MM-dd of the arriving stay, when known. */
  stayStartDate: string | null;
  sameDay: boolean;
};

export type JobListCharge = {
  amount: number | null;
  source: ClientChargeSource;
  missing: boolean;
};

type ExtrasInput = {
  id: string;
  jobType: JobType;
  propertyId: string;
  fixedPrice: number | null;
  internalNotes: string | null;
  sameDayCheckin: boolean;
};

export function guestInForJob(job: Pick<ExtrasInput, "internalNotes" | "sameDayCheckin">): JobGuestIn {
  const context = parseJobInternalNotes(job.internalNotes).reservationContext;
  const checkin = context?.checkinAtLocal && Number.isFinite(Date.parse(context.checkinAtLocal)) ? context.checkinAtLocal : null;
  return {
    checkinAt: checkin,
    stayStartDate: context?.stayStartDate ?? null,
    sameDay: job.sameDayCheckin === true,
  };
}

type ChargeInputs = Parameters<typeof computeClientCharge>[1];
type ChargeJob = Pick<ExtrasInput, "jobType" | "propertyId" | "fixedPrice">;

/**
 * The rate tables `computeClientCharge` reads for a set of jobs: the same
 * inputs the invoice generator and dashboards pass. One read per table.
 * Shared by the list's Charge column and the Charge sort, so both use one rule.
 */
export async function loadChargeInputs(jobs: ReadonlyArray<Pick<ExtrasInput, "jobType" | "propertyId">>): Promise<ChargeInputs> {
  const propertyIds = Array.from(new Set(jobs.map((job) => job.propertyId)));
  const jobTypes = Array.from(new Set(jobs.map((job) => job.jobType)));
  const [propertyRates, priceBook] = await Promise.all([
    db.propertyClientRate.findMany({
      where: { propertyId: { in: propertyIds }, jobType: { in: jobTypes }, isActive: true },
      select: { propertyId: true, jobType: true, baseCharge: true, defaultDescription: true },
    }),
    db.priceBook.findMany({
      where: { jobType: { in: jobTypes }, isActive: true },
      select: { jobType: true, baseRate: true },
    }),
  ]);
  return { propertyRates, priceBook };
}

/** The list charge for one job: a missing rate stays null with `missing: true`. */
export function chargeForJob(job: ChargeJob, inputs: ChargeInputs): JobListCharge {
  const result = computeClientCharge({ jobType: job.jobType, propertyId: job.propertyId, fixedPrice: job.fixedPrice }, inputs);
  return { amount: result.amount, source: result.source, missing: result.rateMissing || result.amount === null };
}

export async function withListExtras<T extends ExtrasInput>(jobs: T[]): Promise<Array<T & { guestIn: JobGuestIn; charge: JobListCharge }>> {
  if (jobs.length === 0) return [];
  const inputs = await loadChargeInputs(jobs);
  return jobs.map((job) => ({ ...job, guestIn: guestInForJob(job), charge: chargeForJob(job, inputs) }));
}
