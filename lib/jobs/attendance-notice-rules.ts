/**
 * "I can't attend" and "Running late" (pilot "Before-you-start extras",
 * 2026-11-28): shared shapes and limits. Plain module.
 *
 * A notice only tells the office at once (inbox + the approvals phone push,
 * as the cleaner's other requests). It never unassigns the cleaner, moves the
 * job or changes pay: the office decides what to do.
 */
import { z } from "zod";

export const ATTENDANCE_NOTICE_KINDS = ["CANT_ATTEND", "RUNNING_LATE"] as const;
export type AttendanceNoticeKind = (typeof ATTENDANCE_NOTICE_KINDS)[number];

export const ATTENDANCE_NOTICE_LABELS: Record<AttendanceNoticeKind, string> = {
  CANT_ATTEND: "I can't attend",
  RUNNING_LATE: "Running late",
};

export const RUNNING_LATE_MINUTES_MIN = 5;
export const RUNNING_LATE_MINUTES_MAX = 240;

export const attendanceNoticeInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("CANT_ATTEND"),
    requestKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    kind: z.literal("RUNNING_LATE"),
    requestKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
    reason: z.string().trim().min(3).max(500),
    minutes: z.number().int().min(RUNNING_LATE_MINUTES_MIN).max(RUNNING_LATE_MINUTES_MAX),
  }),
]);
export type AttendanceNoticeInput = z.infer<typeof attendanceNoticeInput>;

/** Job statuses before work starts, when these notices make sense. */
export const ATTENDANCE_NOTICE_STATUSES: readonly string[] = ["ASSIGNED", "EN_ROUTE"];
