/**
 * Shapes the Jobs peek panel reads. Client-safe (no server imports); the
 * server builders live in `peek-summary.ts` and `list-row-extras.ts`.
 */
import { z } from "zod";

export const jobListChargeSchema = z.object({
  amount: z.number().nullable(),
  source: z.enum(["FIXED_JOB", "PROPERTY_RATE", "JOBTYPE_PRICE", "MISSING"]),
  missing: z.boolean(),
});
export type JobListChargeView = z.infer<typeof jobListChargeSchema>;

export const jobGuestInSchema = z.object({
  checkinAt: z.string().nullable(),
  stayStartDate: z.string().nullable(),
  sameDay: z.boolean(),
});
export type JobGuestInView = z.infer<typeof jobGuestInSchema>;

export const jobPeekSummarySchema = z.object({
  id: z.string(),
  jobNumber: z.string().nullable(),
  status: z.string(),
  jobType: z.string(),
  scheduledDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  dueTime: z.string().nullable(),
  cleanSkipStatus: z.string(),
  property: z.object({ id: z.string(), name: z.string(), suburb: z.string().nullable() }),
  client: z.object({ id: z.string(), name: z.string() }).nullable(),
  departing: z.object({
    name: z.string().nullable(),
    phoneLabel: z.string().nullable(),
    phoneHref: z.string().nullable(),
    checkoutAt: z.string().nullable(),
  }).nullable(),
  arriving: z.object({
    name: z.string().nullable(),
    checkinAt: z.string().nullable(),
    guestCountLabel: z.string().nullable(),
    sameDay: z.boolean(),
  }).nullable(),
  laundry: z.object({
    status: z.string(),
    noPickupRequired: z.boolean(),
    pickupDate: z.string(),
    dropoffDate: z.string(),
    pickedUpAt: z.string().nullable(),
    droppedAt: z.string().nullable(),
  }).nullable(),
  charge: jobListChargeSchema,
  assignments: z.array(z.object({ userId: z.string(), name: z.string(), isPrimary: z.boolean(), responseStatus: z.string() })),
  qa: z.object({ status: z.string(), inspector: z.string().nullable() }).nullable(),
});
export type JobPeekSummary = z.infer<typeof jobPeekSummarySchema>;

export const cleanerSuggestionsResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assigned"), reason: z.string() }),
  z.object({
    kind: z.literal("ok"),
    jobId: z.string(),
    considered: z.number(),
    suggestions: z.array(z.object({
      cleanerId: z.string(),
      name: z.string(),
      assignable: z.boolean(),
      blocker: z.object({ kind: z.enum(["clash", "unavailable", "leave"]), reason: z.string() }).nullable(),
      reasons: z.array(z.string()),
      travel: z.object({ km: z.number(), basis: z.enum(["previous_job", "home"]), fromLabel: z.string() }).nullish(),
      qa: z.object({ score: z.number().nullable(), reviewed: z.number(), periodDays: z.number() }).nullish(),
    })),
  }),
]);
export type CleanerSuggestionsResponse = z.infer<typeof cleanerSuggestionsResponseSchema>;
