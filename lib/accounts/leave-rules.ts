/**
 * Leave and days off (Wave E, 2026-11). Pure rules, safe for the browser.
 * Dates are calendar dates (yyyy-MM-dd), end inclusive, never shifted by a
 * timezone.
 */
import { z } from "zod";

export const LEAVE_KINDS = ["LEAVE", "DAY_OFF"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];
export const LEAVE_KIND_LABEL: Record<LeaveKind, string> = { LEAVE: "Leave", DAY_OFF: "Day off" };

/** Longest single record (a year); longer absences are recorded in parts. */
export const MAX_LEAVE_DAYS = 366;

export type LeaveEntry = {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  kind: LeaveKind;
  note: string | null;
};

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date written as YYYY-MM-DD.");

export const leaveInputSchema = z
  .object({
    startDate: dayKey,
    endDate: dayKey,
    kind: z.enum(LEAVE_KINDS),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "The last day cannot be before the first day." });
    else if (leaveLengthDays(value.startDate, value.endDate) > MAX_LEAVE_DAYS) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "Record at most a year at a time." });
  });
export type LeaveInput = z.infer<typeof leaveInputSchema>;

export function leaveLengthDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

export function leaveCoversDay(entry: Pick<LeaveEntry, "startDate" | "endDate">, day: string): boolean {
  return entry.startDate <= day && day <= entry.endDate;
}

export function leaveOverlaps(left: Pick<LeaveEntry, "startDate" | "endDate">, right: Pick<LeaveEntry, "startDate" | "endDate">): boolean {
  return left.startDate <= right.endDate && right.startDate <= left.endDate;
}

/** The first leave record covering `day`, if any. */
export function leaveOnDay<T extends Pick<LeaveEntry, "startDate" | "endDate">>(entries: readonly T[], day: string): T | null {
  return entries.find((entry) => leaveCoversDay(entry, day)) ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

/** "12 Nov", "12–14 Nov", "30 Nov – 2 Dec", "30 Dec 2026 – 2 Jan 2027". */
export function leaveRangeLabel(startDate: string, endDate: string): string {
  const a = parts(startDate);
  const b = parts(endDate);
  if (startDate === endDate) return `${a.day} ${MONTHS[a.month - 1]}`;
  if (a.year !== b.year) return `${a.day} ${MONTHS[a.month - 1]} ${a.year} – ${b.day} ${MONTHS[b.month - 1]} ${b.year}`;
  if (a.month === b.month) return `${a.day}–${b.day} ${MONTHS[a.month - 1]}`;
  return `${a.day} ${MONTHS[a.month - 1]} – ${b.day} ${MONTHS[b.month - 1]}`;
}

/** Which kind of unavailability a lane reason describes (leave reasons start with these words). */
export function unavailabilityKind(reason: string): "leave" | "day-off" | "roster" {
  if (reason.startsWith("On leave ")) return "leave";
  if (reason.startsWith("Day off ")) return "day-off";
  return "roster";
}

/** The reason shown wherever leave blocks work: "On leave 12–14 Nov", "Day off 12 Nov". */
export function leaveReason(entry: Pick<LeaveEntry, "startDate" | "endDate" | "kind">): string {
  const range = leaveRangeLabel(entry.startDate, entry.endDate);
  return entry.kind === "DAY_OFF" ? `Day off ${range}` : `On leave ${range}`;
}
