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

export async function withListExtras<T extends ExtrasInput>(jobs: T[]): Promise<Array<T & { guestIn: JobGuestIn; charge: JobListCharge }>> {
  if (jobs.length === 0) return [];
  const propertyIds = Array.from(new Set(jobs.map((job) => job.propertyId)));
  const jobTypes = Array.from(new Set(jobs.map((job) => job.jobType)));
  // Same inputs the invoice generator and dashboards pass to computeClientCharge.
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
  return jobs.map((job) => {
    const result = computeClientCharge(
      { jobType: job.jobType, propertyId: job.propertyId, fixedPrice: job.fixedPrice },
      { propertyRates, priceBook },
    );
    return {
      ...job,
      guestIn: guestInForJob(job),
      charge: { amount: result.amount, source: result.source, missing: result.rateMissing || result.amount === null },
    };
  });
}
