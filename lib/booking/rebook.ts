import { MARKETED_SERVICES } from "@/lib/marketing/catalog";

export const BOOKABLE_SERVICES = MARKETED_SERVICES.filter(service =>
  ["GENERAL_CLEAN", "DEEP_CLEAN", "END_OF_LEASE", "AIRBNB_TURNOVER", "SPRING_CLEANING"].includes(service.jobType));

export type RebookSeed = { propertyId: string; jobType: string };

export function canRebookJob(job: { status: string; jobType: string; isRework?: boolean }): boolean {
  return !job.isRework && ["COMPLETED", "INVOICED"].includes(job.status) && BOOKABLE_SERVICES.some(service => service.jobType === job.jobType);
}

/** Copy only the two choices, after the server has authorized the prior job. */
export function rebookSeed(job: ({ propertyId: string } & Parameters<typeof canRebookJob>[0]) | null,
  activePropertyIds: readonly string[]): RebookSeed | null {
  return job && canRebookJob(job) && activePropertyIds.includes(job.propertyId)
    ? { propertyId: job.propertyId, jobType: job.jobType } : null;
}

/**
 * "Book a clean here" (owner decision 2026-11-13): the property a booking
 * opens with, from `?propertyId=`. Only a property in the list the server
 * already scoped to this client or assistant (active, `propertyScopeWhere`) is
 * used; anything else is ignored and the page says so. Never trusted from the
 * link.
 */
export type BookingPropertyPrefill =
  | { propertyId: string; notice: null }
  | { propertyId: null; notice: "not-available" | null };

export function bookingPropertyPrefill(requested: unknown, scopedPropertyIds: readonly string[]): BookingPropertyPrefill {
  if (typeof requested !== "string" || !requested.trim()) return { propertyId: null, notice: null };
  const id = requested.trim();
  return scopedPropertyIds.includes(id) ? { propertyId: id, notice: null } : { propertyId: null, notice: "not-available" };
}
