/**
 * Laundry status groups. PURE and PLAIN (no "use client", no Prisma import) so
 * server pages, client components and tests share one answer.
 *
 * READY_TO_RETURN (2026-11-13) sits between PICKED_UP and DROPPED: the laundry
 * partner's team says the set is washed and waiting to go back. For every rule
 * that asked "is the set at the laundry / out of the property, not yet
 * delivered?" it behaves exactly like PICKED_UP (lanes, overdue drops,
 * turnaround, route drop candidates, cleaner and client "with the laundry"
 * views, reports by status). It is optional: a run may go from PICKED_UP
 * straight to DROPPED.
 */

/** Picked up and not yet delivered: at the laundry, with or without "ready". */
export const AT_LAUNDRY_STATUSES = ["PICKED_UP", "READY_TO_RETURN"] as const;
export type AtLaundryStatus = (typeof AT_LAUNDRY_STATUSES)[number];

const AT_LAUNDRY = new Set<string>(AT_LAUNDRY_STATUSES);

export function isAtLaundryStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && AT_LAUNDRY.has(status);
}

export function isReadyToReturnStatus(status: string | null | undefined): boolean {
  return status === "READY_TO_RETURN";
}

/** The label used everywhere the new stage is named. */
export const READY_TO_RETURN_LABEL = "Ready to return";
