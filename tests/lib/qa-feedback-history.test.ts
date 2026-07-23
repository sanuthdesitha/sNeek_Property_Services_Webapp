import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The briefing's "Previous QA at this property" used to read the legacy
 * QaFormSubmission.score percent — 0 whenever an inspection was graded purely
 * with accountability verdicts, so a genuinely failed clean showed as 0% (or a
 * passing legacy percent hid a failed review). The authoritative score lives
 * on QAReview: kind "QA" outranks "ADMIN", and its score/passed decide.
 */

const findManyReviews = vi.fn();
const findFirstSubmission = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    qAReview: { findMany: (...a: unknown[]) => findManyReviews(...a) },
    qaFormSubmission: { findFirst: (...a: unknown[]) => findFirstSubmission(...a) },
  },
}));

const { getNegativeQaWarning } = await import("@/lib/qa/feedback-history");

function review(over: Record<string, unknown>) {
  return {
    id: "rev-1",
    jobId: "job-1",
    score: 77,
    passed: false,
    kind: "QA",
    notes: "Bathroom missed",
    createdAt: new Date("2026-07-20T10:00:00Z"),
    job: { id: "job-1", jobNumber: "J-100" },
    ...over,
  };
}

beforeEach(() => {
  findManyReviews.mockReset();
  findFirstSubmission.mockReset();
  findFirstSubmission.mockResolvedValue(null);
});

describe("getNegativeQaWarning", () => {
  it("uses the authoritative QAReview score, not the legacy submission percent", async () => {
    findManyReviews.mockResolvedValue([review({ score: 77, passed: false })]);
    findFirstSubmission.mockResolvedValue({
      notes: "sub notes",
      data: { "cleaner-feedback": "Please re-do the shower glass." },
    });

    const warning = await getNegativeQaWarning("cleaner-1", "prop-1");
    expect(warning).not.toBeNull();
    expect(warning!.percent).toBe(77);
    // A failed review is a FAIL banner even when the raw score sits in the
    // legacy warning range.
    expect(warning!.band).toBe("FAIL");
    expect(warning!.jobNumber).toBe("J-100");
    expect(warning!.cleanerFeedback).toBe("Please re-do the shower glass.");
  });

  it("prefers a kind-QA review over a newer ADMIN review for the same job", async () => {
    // Rows arrive createdAt-desc: newest first is the ADMIN quick score.
    findManyReviews.mockResolvedValue([
      review({ id: "rev-admin", kind: "ADMIN", score: 30, passed: false, createdAt: new Date("2026-07-21T10:00:00Z") }),
      review({ id: "rev-qa", kind: "QA", score: 55, passed: false, createdAt: new Date("2026-07-20T10:00:00Z") }),
    ]);

    const warning = await getNegativeQaWarning("cleaner-1", "prop-1");
    expect(warning!.percent).toBe(55);
    expect(warning!.band).toBe("FAIL");
  });

  it("ignores passing reviews", async () => {
    findManyReviews.mockResolvedValue([
      review({ score: 92, passed: true }),
      review({ jobId: "job-2", job: { id: "job-2", jobNumber: "J-99" }, score: 85, passed: true }),
    ]);

    expect(await getNegativeQaWarning("cleaner-1", "prop-1")).toBeNull();
  });

  it("a passing authoritative QA review hides an older failed ADMIN score on the same job", async () => {
    findManyReviews.mockResolvedValue([
      review({ id: "rev-qa", kind: "QA", score: 95, passed: true, createdAt: new Date("2026-07-21T10:00:00Z") }),
      review({ id: "rev-admin", kind: "ADMIN", score: 20, passed: false, createdAt: new Date("2026-07-19T10:00:00Z") }),
    ]);

    expect(await getNegativeQaWarning("cleaner-1", "prop-1")).toBeNull();
  });

  it("returns null when there is no review history", async () => {
    findManyReviews.mockResolvedValue([]);
    expect(await getNegativeQaWarning("cleaner-1", "prop-1")).toBeNull();
  });

  it("scopes the lookup to QA/ADMIN reviews for this cleaner at this property", async () => {
    findManyReviews.mockResolvedValue([]);
    await getNegativeQaWarning("cleaner-1", "prop-1");
    expect(findManyReviews).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: { in: ["QA", "ADMIN"] },
          job: expect.objectContaining({
            propertyId: "prop-1",
            assignments: { some: { userId: "cleaner-1", removedAt: null } },
          }),
        }),
      })
    );
  });
});
