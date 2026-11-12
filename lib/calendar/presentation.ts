/**
 * Pure calendar facts derived from stored job fields: the hours a job counts
 * for, whether it is late, whether a guest arrives that day, and the chip
 * category the page draws. No database access and no clock of its own.
 */
import { formatInTimeZone } from "date-fns-tz";
import { jobWindow } from "@/lib/jobs/cleaner-suggestions";
import type { JobReservationContext } from "@/lib/jobs/meta";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import type { CalendarJob } from "./types";

export const HOURS_BASIS =
  "Scheduled hours: each job's estimated hours, or its start-to-finish window when no estimate is set. " +
  "Skipped cleans are not counted, and jobs with neither an estimate nor a window are counted separately.";

type HoursInput = { estimatedHours: number | null; startTime: string | null; endTime: string | null; dueTime: string | null };

/** Hours a job counts for in row totals, or null when neither basis is known. */
export function jobScheduledHours(job: HoursInput): number | null {
  if (typeof job.estimatedHours === "number" && Number.isFinite(job.estimatedHours) && job.estimatedHours > 0) {
    return job.estimatedHours;
  }
  const window = jobWindow({ startTime: job.startTime, endTime: job.endTime, dueTime: job.dueTime, estimatedHours: null });
  return window ? (window.end - window.start) / 60 : null;
}

/** "31 h", "7.5 h" — at most one decimal, no trailing ".0". */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} h`;
}

const PRE_START_WITH_CLEANER = new Set(["OFFERED", "ASSIGNED", "EN_ROUTE"]);

/**
 * Late: someone is on the job, work has not started, and the start time has
 * passed in Sydney (or the day itself is past). A job without a start time is
 * late only once its day is over.
 */
export function isJobLate(job: { status: string; day: string; startTime: string | null; hasCleaner: boolean; skipped: boolean }, now: Date): boolean {
  if (job.skipped || !job.hasCleaner || !PRE_START_WITH_CLEANER.has(job.status)) return false;
  const today = formatInTimeZone(now, SYDNEY_TZ, "yyyy-MM-dd");
  if (job.day < today) return true;
  if (job.day > today || !job.startTime || !/^\d{2}:\d{2}$/.test(job.startTime)) return false;
  return job.startTime < formatInTimeZone(now, SYDNEY_TZ, "HH:mm");
}

type ArrivalInput = {
  day: string;
  reservationContext: JobReservationContext | undefined;
  sameDayCheckin: boolean;
  sameDayCheckinTime: string | null;
  manuallyRescheduled: boolean;
};

/**
 * A guest checks in on the job's day. The arriving stay comes from
 * `jobMeta.reservationContext` (the iCal sync writes it): its check-in
 * instant (shown in Sydney time) or its stay start date. Only when the job has
 * no such context does the stored `sameDayCheckin` flag count, and then not
 * after a manual reschedule, because the sync no longer refreshes that flag
 * for a job someone moved by hand.
 */
export function guestArrivalOnDay(input: ArrivalInput): { time: string | null } | null {
  const context = input.reservationContext;
  const fromBooking = context?.preparationSource !== "PROPERTY_MAX";
  const checkin = fromBooking && context?.checkinAtLocal ? new Date(context.checkinAtLocal) : null;
  if (checkin && !Number.isNaN(checkin.getTime())) {
    return formatInTimeZone(checkin, SYDNEY_TZ, "yyyy-MM-dd") === input.day
      ? { time: formatInTimeZone(checkin, SYDNEY_TZ, "HH:mm") }
      : null;
  }
  if (fromBooking && context?.stayStartDate) {
    return context.stayStartDate.slice(0, 10) === input.day ? { time: input.sameDayCheckinTime } : null;
  }
  if (input.sameDayCheckin && !input.manuallyRescheduled) return { time: input.sameDayCheckinTime };
  return null;
}

export type ChipCategory = "done" | "onSite" | "late" | "offered" | "planned" | "unassigned" | "skipped" | "cancelled";

const DONE = new Set(["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"]);
const ON_SITE = new Set(["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"]);

export function chipCategory(job: Pick<CalendarJob, "status" | "cleaners" | "late" | "skipped">): ChipCategory {
  if (job.status === "CANCELLED") return "cancelled";
  if (job.skipped) return "skipped";
  if (DONE.has(job.status)) return "done";
  if (ON_SITE.has(job.status)) return "onSite";
  if (job.cleaners.length === 0) return "unassigned";
  if (job.late) return "late";
  if (job.status === "OFFERED") return "offered";
  return "planned";
}

/** The words a chip carries beside its colour (planned carries none, as drawn). */
export const CHIP_CATEGORY_TEXT: Record<ChipCategory, string> = {
  done: "done",
  onSite: "on site",
  late: "late",
  offered: "offered",
  planned: "",
  unassigned: "no cleaner",
  skipped: "skipped",
  cancelled: "cancelled",
};

/** Full wording for screen readers and tooltips. */
export const CHIP_CATEGORY_LABEL: Record<ChipCategory, string> = {
  done: "Done",
  onSite: "On site",
  late: "Late",
  offered: "Offered, awaiting the cleaner",
  planned: "Planned",
  unassigned: "No cleaner",
  skipped: "Skipped",
  cancelled: "Cancelled",
};
