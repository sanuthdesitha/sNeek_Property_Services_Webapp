/**
 * The calendar's wire contract: `GET /api/admin/calendar` and
 * `POST /api/admin/calendar/check-move`. The server builds these shapes and
 * the page parses them with the same schemas, so a changed field fails loudly
 * instead of rendering an empty calendar.
 */
import { z } from "zod";

export const calendarCleanerRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPrimary: z.boolean(),
});
export type CalendarCleanerRef = z.infer<typeof calendarCleanerRefSchema>;

export const calendarJobSchema = z.object({
  id: z.string(),
  jobNumber: z.string(),
  propertyId: z.string(),
  propertyName: z.string(),
  /** True when the property has no name (or the job no property); propertyName is then the address or a placeholder. */
  propertyMissingName: z.boolean(),
  suburb: z.string().nullable(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  jobType: z.string(),
  status: z.string(),
  /** Calendar day (yyyy-MM-dd), never shifted by a timezone. */
  day: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  dueTime: z.string().nullable(),
  estimatedHours: z.number().nullable(),
  /** Hours counted for the row totals (see `hoursBasis`), or null when unknown. */
  hours: z.number().nullable(),
  cleaners: z.array(calendarCleanerRefSchema),
  skipped: z.boolean(),
  /** Pre-start job whose start time (Sydney) has passed. */
  late: z.boolean(),
  /** A guest checks in on the job's day; time is null when the feed gave none. */
  guestArrival: z.object({ time: z.string().nullable() }).nullable(),
  /** Why the calendar will not move this job, or null when it may be moved. */
  moveBlock: z.string().nullable(),
  /** Passed back to the reschedule service as its stale-write guard. */
  updatedAt: z.string(),
  qa: z
    .object({ id: z.string(), status: z.string(), assignedToId: z.string().nullable(), assignedToName: z.string().nullable() })
    .nullable(),
});
export type CalendarJob = z.infer<typeof calendarJobSchema>;

export const calendarRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["cleaner", "property"]),
  /** False for a cleaner whose account is inactive but who has work in range. */
  active: z.boolean(),
  hours: z.number(),
  jobsWithoutHours: z.number(),
  /** Day key → roster reason, for days with no saved hours (cleaners only). */
  unavailable: z.record(z.string()),
});
export type CalendarRow = z.infer<typeof calendarRowSchema>;

export const calendarLaundryItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["pickup", "drop"]),
  propertyName: z.string(),
  status: z.string(),
});
export const calendarLaundryDaySchema = z.object({ pickups: z.number(), drops: z.number(), items: z.array(calendarLaundryItemSchema) });
export type CalendarLaundryDay = z.infer<typeof calendarLaundryDaySchema>;

export const calendarResponseSchema = z.object({
  range: z.object({ start: z.string(), end: z.string(), days: z.array(z.string()) }),
  today: z.string(),
  generatedAt: z.string(),
  rowsMode: z.enum(["cleaners", "properties"]),
  cleanerRows: z.array(calendarRowSchema),
  propertyRows: z.array(calendarRowSchema),
  jobs: z.array(calendarJobSchema),
  /** Null when laundry was not requested. */
  laundry: z.record(calendarLaundryDaySchema).nullable(),
  summary: z.object({
    jobs: z.number(),
    withoutCleaner: z.number(),
    skipped: z.number(),
    /** Jobs in range by status before the status / cleaner filters (client filter applied). */
    statusCounts: z.record(z.number()),
    /** Jobs in range with no cleaner before the status / cleaner filters (client filter applied). */
    unassignedTotal: z.number(),
  }),
  hoursBasis: z.string(),
  /** True when the range held more jobs than one response carries. */
  truncated: z.boolean(),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

export const checkMoveRequestSchema = z.object({
  jobId: z.string().min(1).max(128),
  toDate: z.string(),
  /** The cleaner row the job was dragged from (null: Unassigned lane, property row, or no cleaner change). */
  fromCleanerId: z.string().max(128).nullable().optional(),
  /** The cleaner row it was dropped on (null: keep the job's cleaners). */
  toCleanerId: z.string().max(128).nullable().optional(),
});
export type CheckMoveRequest = z.infer<typeof checkMoveRequestSchema>;

export const moveWarningSchema = z.object({
  kind: z.enum(["clash", "unavailable", "booking", "notice"]),
  text: z.string(),
});
export type MoveWarning = z.infer<typeof moveWarningSchema>;

export const checkMoveResponseSchema = z.object({
  jobId: z.string(),
  propertyName: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  /** Name of the cleaner the job would go to, when the move changes cleaners. */
  toCleanerName: z.string().nullable(),
  /** Refusals: when any is present the move cannot be made. */
  blockers: z.array(z.string()),
  /** Facts to read before confirming (clashes, roster, booking, notifications). */
  warnings: z.array(moveWarningSchema),
  /** What the existing services will be asked to do, in order. */
  plan: z.object({
    reschedule: z.object({ date: z.string(), expectedUpdatedAt: z.string() }).nullable(),
    assign: z.object({ userIds: z.array(z.string()), primaryUserId: z.string().nullable() }).nullable(),
  }),
});
export type CheckMoveResponse = z.infer<typeof checkMoveResponseSchema>;
