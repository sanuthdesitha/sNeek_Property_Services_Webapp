import { describe, expect, it } from "vitest";
import { isLaundryUpdateEligible } from "@/lib/laundry/eligibility";

describe("isLaundryUpdateEligible", () => {
  it("matches the full truth table", () => {
    const cases: Array<{
      jobType: string | null | undefined;
      isRework: boolean | null | undefined;
      laundryEnabled: boolean | null | undefined;
      expected: boolean;
    }> = [
      // Airbnb turnover, not rework — laundryEnabled decides (only explicit false disables)
      { jobType: "AIRBNB_TURNOVER", isRework: false, laundryEnabled: true, expected: true },
      { jobType: "AIRBNB_TURNOVER", isRework: false, laundryEnabled: undefined, expected: true },
      { jobType: "AIRBNB_TURNOVER", isRework: false, laundryEnabled: null, expected: true },
      { jobType: "AIRBNB_TURNOVER", isRework: false, laundryEnabled: false, expected: false },
      // Rework always suppresses
      { jobType: "AIRBNB_TURNOVER", isRework: true, laundryEnabled: true, expected: false },
      { jobType: "AIRBNB_TURNOVER", isRework: true, laundryEnabled: false, expected: false },
      // Non-turnover job types never have laundry
      { jobType: "DEEP_CLEAN", isRework: false, laundryEnabled: true, expected: false },
      { jobType: "END_OF_LEASE", isRework: false, laundryEnabled: true, expected: false },
      { jobType: undefined, isRework: false, laundryEnabled: true, expected: false },
      { jobType: null, isRework: false, laundryEnabled: true, expected: false },
      // Missing rework flag treated as not-rework (matches `isRework !== true`)
      { jobType: "AIRBNB_TURNOVER", isRework: undefined, laundryEnabled: true, expected: true },
      { jobType: "AIRBNB_TURNOVER", isRework: null, laundryEnabled: true, expected: true },
    ];

    for (const c of cases) {
      expect(
        isLaundryUpdateEligible(
          { jobType: c.jobType, isRework: c.isRework },
          { laundryEnabled: c.laundryEnabled }
        ),
        JSON.stringify(c)
      ).toBe(c.expected);
    }
  });

  it("treats a missing job or property object safely", () => {
    expect(isLaundryUpdateEligible(null, { laundryEnabled: true })).toBe(false);
    expect(isLaundryUpdateEligible(undefined, undefined)).toBe(false);
    // Missing property data keeps laundry ON for a turnover (historical behaviour
    // of the laundry-status route's `job.property?.laundryEnabled === false`).
    expect(isLaundryUpdateEligible({ jobType: "AIRBNB_TURNOVER", isRework: false }, null)).toBe(true);
    expect(
      isLaundryUpdateEligible({ jobType: "AIRBNB_TURNOVER", isRework: false }, undefined)
    ).toBe(true);
  });
});
