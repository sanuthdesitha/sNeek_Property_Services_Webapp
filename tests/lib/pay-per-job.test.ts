import { describe, it, expect } from "vitest";
import { JobType } from "@prisma/client";
import { computeJobPayForCleaner } from "@/lib/finance/job-pay-for-cleaner";

const JT = JobType.AIRBNB_TURNOVER;

describe("computeJobPayForCleaner", () => {
  it("returns null when the cleaner has no active assignment on the job", () => {
    expect(
      computeJobPayForCleaner({
        cleanerId: "c1",
        job: { jobType: JT, estimatedHours: 2 },
        assignments: [{ userId: "other", payRate: 40 }],
        userHourlyRate: null,
      })
    ).toBeNull();
  });

  it("job-type rate × allocated time, split across active assignments", () => {
    // 3 allocated hours, 2 cleaners → 1.5h each; payRate 40 → $60.
    expect(
      computeJobPayForCleaner({
        cleanerId: "c1",
        job: { jobType: JT, estimatedHours: 3 },
        assignments: [
          { userId: "c1", payRate: 40 },
          { userId: "c2", payRate: 40 },
        ],
        userHourlyRate: null,
      })
    ).toBe(60);
  });

  it("falls back to the user's hourly rate when no assignment/setting rate", () => {
    // Solo, 2h × 30 = $60.
    expect(
      computeJobPayForCleaner({
        cleanerId: "c1",
        job: { jobType: JT, estimatedHours: 2 },
        assignments: [{ userId: "c1", payRate: null }],
        userHourlyRate: 30,
      })
    ).toBe(60);
  });

  it("uses the per-cleaner custom payout in place of hours×rate", () => {
    expect(
      computeJobPayForCleaner({
        cleanerId: "c1",
        job: { jobType: JT, estimatedHours: 3 },
        assignments: [{ userId: "c1", payRate: 40 }],
        userHourlyRate: null,
        cleanerPayouts: { c1: 85 },
      })
    ).toBe(85);
  });

  it("adds the per-cleaner transport allowance on top", () => {
    // 2h × 40 = 80 base + 15 transport = $95.
    expect(
      computeJobPayForCleaner({
        cleanerId: "c1",
        job: { jobType: JT, estimatedHours: 2 },
        assignments: [{ userId: "c1", payRate: 40 }],
        userHourlyRate: null,
        transportAllowances: { c1: 15 },
      })
    ).toBe(95);
  });

  it("rework pay = reworkPayAmount, never hours×rate", () => {
    expect(
      computeJobPayForCleaner({
        cleanerId: "c1",
        job: { jobType: JT, estimatedHours: 4, isRework: true, reworkPayAmount: 25 },
        assignments: [{ userId: "c1", payRate: 40 }],
        userHourlyRate: null,
        // A stray custom payout must NOT win over the rework amount.
        cleanerPayouts: { c1: 200 },
      })
    ).toBe(25);
  });

  it("unpaid rework (reworkPayAmount null) pays $0", () => {
    expect(
      computeJobPayForCleaner({
        cleanerId: "c1",
        job: { jobType: JT, estimatedHours: 4, isRework: true, reworkPayAmount: null },
        assignments: [{ userId: "c1", payRate: 40 }],
        userHourlyRate: null,
      })
    ).toBe(0);
  });
});
