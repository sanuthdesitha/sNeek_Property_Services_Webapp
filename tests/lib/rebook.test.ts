import { describe, expect, it } from "vitest";
import { canRebookJob, rebookSeed } from "@/lib/booking/rebook";

describe("rebook seed", () => {
  const prior = { propertyId: "p1", jobType: "DEEP_CLEAN", status: "COMPLETED", isRework: false };
  it("copies only currently eligible property and supported service", () => {
    const old = { ...prior, scheduledDate: "2001-01-01", notes: "Private access", approvedPrice: 99, approvalId: "old" };
    expect(rebookSeed(old, ["p1"])).toEqual({ propertyId: "p1", jobType: "DEEP_CLEAN" });
    expect(canRebookJob({ ...prior, status: "INVOICED" })).toBe(true);
  });
  it("rejects missing/inactive/out-of-scope properties, unfinished work, rework and unsupported services", () => {
    expect(rebookSeed(prior, [])).toBeNull();
    expect(rebookSeed(null, ["p1"])).toBeNull();
    expect(rebookSeed({ ...prior, jobType: "MAINTENANCE" }, ["p1"])).toBeNull();
    expect(rebookSeed({ ...prior, status: "IN_PROGRESS" }, ["p1"])).toBeNull();
    expect(rebookSeed({ ...prior, isRework: true }, ["p1"])).toBeNull();
  });
});
