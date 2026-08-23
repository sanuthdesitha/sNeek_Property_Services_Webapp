import { describe, it, expect, vi } from "vitest";
import {
  assertNotSelfInspection,
  mayInspectClean,
  selfReviewRefusalMessage,
} from "@/lib/qa/self-review";

/**
 * NOBODY INSPECTS THEIR OWN CLEAN.
 *
 * The owner's explicit rule. A version of it existed for maintenance items and
 * guarded a different table entirely; the rail that actually scores a clean —
 * `QaAssignment` — had no guard on any of its six write paths, including the
 * self-claim ones where an inspector picks up an open inspection themselves.
 *
 * Not exploitable before multi-role, because job assignment requires CLEANER
 * and QA pickup requires QA_INSPECTOR/OPS_MANAGER/ADMIN. These tests exist so
 * that stays true once one account can hold both.
 */
function stubDb(cleanerIds: string[]) {
  const findMany = vi.fn(async () => cleanerIds.map((userId) => ({ userId })));
  return { db: { jobAssignment: { findMany } } as any, findMany };
}

describe("mayInspectClean", () => {
  it("blocks someone who is on the job", () => {
    expect(mayInspectClean({ candidateUserId: "u1", jobCleanerUserIds: ["u1"] })).toBe(false);
    expect(mayInspectClean({ candidateUserId: "u1", jobCleanerUserIds: ["u2", "u1"] })).toBe(false);
  });

  it("allows an independent inspector", () => {
    expect(mayInspectClean({ candidateUserId: "u3", jobCleanerUserIds: ["u1", "u2"] })).toBe(true);
  });

  it("allows anyone when the job has no cleaners recorded", () => {
    // An unassigned job is not a conflict — refusing here would block every
    // inspection of work whose roster was cleared.
    expect(mayInspectClean({ candidateUserId: "u1", jobCleanerUserIds: [] })).toBe(true);
  });
});

describe("selfReviewRefusalMessage", () => {
  it("speaks to the inspector when they claimed it themselves", () => {
    expect(selfReviewRefusalMessage(true)).toMatch(/you cleaned this job/i);
  });

  it("speaks to the admin when they assigned somebody else", () => {
    expect(selfReviewRefusalMessage(false)).toMatch(/that person cleaned this job/i);
  });
});

describe("assertNotSelfInspection", () => {
  it("throws when the candidate cleaned the job", async () => {
    const { db } = stubDb(["u1", "u2"]);
    await expect(
      assertNotSelfInspection(db, { jobId: "job-1", candidateUserId: "u1" })
    ).rejects.toThrow(/cannot inspect it/i);
  });

  it("resolves for an independent inspector", async () => {
    const { db } = stubDb(["u1", "u2"]);
    await expect(
      assertNotSelfInspection(db, { jobId: "job-1", candidateUserId: "u9" })
    ).resolves.toBeUndefined();
  });

  it("only counts CURRENT cleaners — a removed one is not a conflict", async () => {
    // Somebody taken off the roster did not do this clean, and blocking them
    // forever would shrink the pool of inspectors for no reason.
    const { db, findMany } = stubDb([]);
    await assertNotSelfInspection(db, { jobId: "job-1", candidateUserId: "u1" });
    expect(findMany).toHaveBeenCalledWith({
      where: { jobId: "job-1", removedAt: null },
      select: { userId: true },
    });
  });

  it("scopes to the job being inspected, not the person's whole history", async () => {
    const { db, findMany } = stubDb(["u1"]);
    await expect(
      assertNotSelfInspection(db, { jobId: "job-7", candidateUserId: "u1" })
    ).rejects.toThrow();
    expect(findMany.mock.calls[0][0].where.jobId).toBe("job-7");
  });

  it("uses the self-claim wording when the caller is claiming their own", async () => {
    const { db } = stubDb(["u1"]);
    await expect(
      assertNotSelfInspection(db, { jobId: "job-1", candidateUserId: "u1", isSelf: true })
    ).rejects.toThrow(/you cleaned this job/i);
  });

  it("THROWS rather than resolving quietly", async () => {
    // A silently-refused claim leaves an inspector believing they have the job
    // and an admin believing it is covered — and nobody inspects it.
    const { db } = stubDb(["u1"]);
    let threw = false;
    try {
      await assertNotSelfInspection(db, { jobId: "job-1", candidateUserId: "u1" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
