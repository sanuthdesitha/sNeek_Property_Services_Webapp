import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The admin QA path used to create a rework job by itself on any failing
 * score. That schedules a real job, assigns a cleaner and emails the client
 * twice, so the behaviour worth pinning is: what does it now report, and can it
 * ever create a duplicate?
 */

const findFirstJob = vi.fn();
const findFirstReview = vi.fn();
const findFirstTransfer = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    job: { findFirst: (...a: unknown[]) => findFirstJob(...a) },
    qAReview: { findFirst: (...a: unknown[]) => findFirstReview(...a) },
    qaReworkTransfer: { findFirst: (...a: unknown[]) => findFirstTransfer(...a) },
  },
}));

const { getAdminReworkContext, reworkTagFor } = await import("@/lib/qa/admin-rework");

const JOB = { id: "job-1", propertyId: "prop-1", jobType: "AIRBNB_TURNOVER" };

beforeEach(() => {
  findFirstJob.mockReset();
  findFirstReview.mockReset();
  findFirstTransfer.mockReset();
});

describe("getAdminReworkContext", () => {
  it("reports a clean slate when nothing exists", async () => {
    findFirstJob.mockResolvedValue(null);
    findFirstReview.mockResolvedValue(null);
    findFirstTransfer.mockResolvedValue(null);

    expect(await getAdminReworkContext(JOB)).toEqual({
      existingReworkJobId: null,
      inspectorReviewed: false,
      inspectorRequestedRework: false,
    });
  });

  it("finds an existing rework job by the modern reworkOfJobId link", async () => {
    // First call = the reworkOfJobId lookup, second = the legacy tag lookup.
    findFirstJob.mockResolvedValueOnce({ id: "rework-9" }).mockResolvedValueOnce(null);
    findFirstReview.mockResolvedValue(null);
    findFirstTransfer.mockResolvedValue(null);

    const ctx = await getAdminReworkContext(JOB);
    expect(ctx.existingReworkJobId).toBe("rework-9");
    // A linked rework job means the inspector already asked for one.
    expect(ctx.inspectorRequestedRework).toBe(true);
  });

  it("still finds pre-link rework jobs via the legacy internalNotes tag", async () => {
    findFirstJob.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "legacy-3" });
    findFirstReview.mockResolvedValue(null);
    findFirstTransfer.mockResolvedValue(null);

    const ctx = await getAdminReworkContext(JOB);
    expect(ctx.existingReworkJobId).toBe("legacy-3");
    // A legacy tag says nothing about who asked, so it must not be claimed as
    // an inspector request.
    expect(ctx.inspectorRequestedRework).toBe(false);
  });

  it("distinguishes 'inspector looked and declined' from 'nobody looked'", async () => {
    findFirstJob.mockResolvedValue(null);
    findFirstTransfer.mockResolvedValue(null);

    findFirstReview.mockResolvedValue({ id: "rev-1" });
    const looked = await getAdminReworkContext(JOB);
    expect(looked.inspectorReviewed).toBe(true);
    expect(looked.inspectorRequestedRework).toBe(false);

    findFirstReview.mockResolvedValue(null);
    const nobody = await getAdminReworkContext(JOB);
    expect(nobody.inspectorReviewed).toBe(false);
  });

  it("treats a rework transfer as an inspector request", async () => {
    findFirstJob.mockResolvedValue(null);
    findFirstReview.mockResolvedValue({ id: "rev-1" });
    findFirstTransfer.mockResolvedValue({ id: "transfer-1" });

    const ctx = await getAdminReworkContext(JOB);
    expect(ctx.inspectorRequestedRework).toBe(true);
  });

  it("only counts an on-site inspection, not a client rating", async () => {
    findFirstJob.mockResolvedValue(null);
    findFirstReview.mockResolvedValue(null);
    findFirstTransfer.mockResolvedValue(null);
    await getAdminReworkContext(JOB);
    // The query must be scoped to kind "QA" — a client star-rating is a
    // different kind and must not read as "an inspector looked at this".
    expect(findFirstReview).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ kind: "QA" }) }),
    );
  });

  it("scopes the dedupe tag to the job it belongs to", () => {
    expect(reworkTagFor("job-1")).toBe("rework-of:job-1");
    expect(reworkTagFor("job-2")).not.toBe(reworkTagFor("job-1"));
  });
});
