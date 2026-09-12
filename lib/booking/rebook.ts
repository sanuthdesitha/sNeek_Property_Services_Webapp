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
