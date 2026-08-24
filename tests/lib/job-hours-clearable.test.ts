import { describe, it, expect } from "vitest";
import { createJobSchema, updateJobSchema } from "@/lib/validations/job";

/**
 * Job hours could be SET but never CLEARED.
 *
 * `estimatedHours` was `z.number().positive().optional()`, so a blank box sent
 * `undefined`, and the PATCH route builds its Prisma payload with
 * `const data = { ...body }` — an absent key is not an instruction to clear, it
 * is no instruction at all. The old value survived every attempt to remove it.
 *
 * Clearing is a real mode rather than data loss: `computeCleanerPay` falls back
 * to the cleaner's CLOCKED timer hours when no allocated time is set, which is
 * what an admin means by "pay them for the time they actually spent".
 *
 * No test covered lib/validations/job.ts before this one, which is a large part
 * of why the gap survived.
 */
const BASE = {
  jobType: "AIRBNB_TURNOVER" as const,
  scheduledDate: "2026-08-24T00:00:00.000Z",
  propertyId: "prop_1",
};

describe("updateJobSchema — estimatedHours", () => {
  it("ACCEPTS null, which is how the form now says 'clear this'", () => {
    const parsed = updateJobSchema.safeParse({ estimatedHours: null });
    expect(parsed.success).toBe(true);
    // The key must be PRESENT and null — `{ ...body }` only carries an
    // instruction to clear when the key actually survives parsing.
    expect(parsed.success && "estimatedHours" in parsed.data).toBe(true);
    expect(parsed.success && parsed.data.estimatedHours).toBeNull();
  });

  it("still accepts a positive number", () => {
    const parsed = updateJobSchema.safeParse({ estimatedHours: 3.5 });
    expect(parsed.success && parsed.data.estimatedHours).toBe(3.5);
  });

  it("still REJECTS zero and negatives", () => {
    // A 0 is an empty box everywhere in this codebase and null is how you say
    // "empty" here. Accepting 0 would give two spellings for one meaning.
    expect(updateJobSchema.safeParse({ estimatedHours: 0 }).success).toBe(false);
    expect(updateJobSchema.safeParse({ estimatedHours: -2 }).success).toBe(false);
  });

  it("leaves hours untouched when the key is absent", () => {
    // The distinction the bug turned on: undefined means "I am not saying
    // anything about hours", null means "remove them". Both must be possible.
    const parsed = updateJobSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.estimatedHours).toBeUndefined();
  });
});

describe("createJobSchema — estimatedHours", () => {
  it("accepts a positive number", () => {
    const parsed = createJobSchema.safeParse({ ...BASE, estimatedHours: 4 });
    expect(parsed.success && parsed.data.estimatedHours).toBe(4);
  });

  it("accepts a job created with no hours at all", () => {
    // Legitimate: pay then falls back to clocked timer hours.
    expect(createJobSchema.safeParse(BASE).success).toBe(true);
  });

  it("rejects zero on create too", () => {
    expect(createJobSchema.safeParse({ ...BASE, estimatedHours: 0 }).success).toBe(false);
  });
});
