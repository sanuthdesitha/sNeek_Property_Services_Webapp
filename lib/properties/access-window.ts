import { addDaysToKey, sydneyDayStart } from "@/lib/time/sydney-range";

/**
 * When a cleaner may read a property's access details (lockbox, door and
 * alarm codes, key location, the access guide).
 *
 * Owner's rule: from the moment they ACCEPT the job until the end of the day
 * after the clean. An offer they have not accepted, and a clean that finished
 * days ago, give no access. A job that is under way stays open even if it has
 * run past that day, so nobody is locked out in the middle of a clean.
 */
export const ACCESS_DAYS_AFTER_CLEAN = 1;

const UNDER_WAY = new Set(["EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"]);

export type AccessWindowReason = "OPEN" | "NOT_ACCEPTED" | "EXPIRED";

export type AccessWindowInput = {
  /** This cleaner's own assignment response. */
  responseStatus: string | null | undefined;
  /** The job's calendar date, stored as UTC midnight of that day. */
  scheduledDate: Date;
  jobStatus: string;
};

/** The first instant at which access is closed again. */
export function accessWindowEnd(scheduledDate: Date): Date {
  const dayKey = scheduledDate.toISOString().slice(0, 10);
  return sydneyDayStart(addDaysToKey(dayKey, ACCESS_DAYS_AFTER_CLEAN + 1));
}

export function cleanerAccessWindow(input: AccessWindowInput, now: Date = new Date()): AccessWindowReason {
  if (UNDER_WAY.has(input.jobStatus)) return "OPEN";
  if (input.responseStatus !== "ACCEPTED") return "NOT_ACCEPTED";
  return now.getTime() < accessWindowEnd(input.scheduledDate).getTime() ? "OPEN" : "EXPIRED";
}

export function accessWindowMessage(reason: AccessWindowReason): string | null {
  if (reason === "NOT_ACCEPTED") return "Access details appear once you accept this job.";
  if (reason === "EXPIRED") return "Access details are no longer shown for this job. Contact the office if you need them.";
  return null;
}

/**
 * Prisma filter: jobs at a property that currently give this cleaner access.
 * Used where access is read by property rather than by job.
 */
export function jobsGivingAccessWhere(userId: string, now: Date = new Date()) {
  // scheduledDate is UTC midnight of the calendar day; the window covers that
  // day and the next, in Sydney. Two days back is the earliest that can still
  // be open, and the precise check is made per job afterwards.
  const earliest = new Date(now.getTime() - (ACCESS_DAYS_AFTER_CLEAN + 2) * 24 * 60 * 60_000);
  return {
    OR: [
      {
        status: { in: Array.from(UNDER_WAY) as never[] },
        assignments: { some: { userId, removedAt: null } },
      },
      {
        scheduledDate: { gte: earliest },
        assignments: { some: { userId, removedAt: null, responseStatus: "ACCEPTED" as never } },
      },
    ],
  };
}
