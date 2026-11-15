/**
 * Wire contract of `GET /api/admin/jobs/assign-facts` (read only): what the
 * shared assign dialog shows BEFORE saving. Plain module (server route and
 * client dialog both read it).
 *
 * The assign routes still decide: a warning here is the same fact the server
 * answers with 409 LEAVE_CONFLICT, shown early. A cleaner missing from
 * `cleaners` (or a failed read) means "not known", never "no warnings".
 */
import { z } from "zod";

export const assignFactWarningSchema = z.object({
  kind: z.enum(["leave", "police_check", "visa"]),
  jobId: z.string(),
  /** Sentence fragment from the server ("On leave 19–23 Nov", "police check expired 2 Oct 2026"). */
  text: z.string(),
});
export type AssignFactWarning = z.infer<typeof assignFactWarningSchema>;

export const assignFactsResponseSchema = z.object({
  jobs: z.array(z.object({ id: z.string(), dayKey: z.string() })),
  cleaners: z.array(z.object({
    userId: z.string(),
    /** Other jobs that day; only when one job is asked about, else null. */
    otherJobsThatDay: z.number().int().nullable(),
    warnings: z.array(assignFactWarningSchema),
  })),
});
export type AssignFactsResponse = z.infer<typeof assignFactsResponseSchema>;

/** At most this many jobs per read (the bulk bar's selection). */
export const ASSIGN_FACTS_MAX_JOBS = 200;
