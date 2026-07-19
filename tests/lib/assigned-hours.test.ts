import { describe, it, expect } from "vitest";
import { resolveExpectedHours } from "@/lib/jobs/window";

describe("resolveExpectedHours — decimal + property assigned hours", () => {
  it("uses the job's own decimal estimatedHours first (2.75 survives)", () => {
    expect(
      resolveExpectedHours({ jobType: "AIRBNB_TURNOVER", estimatedHours: 2.75 }, { assignedCleaningHours: 4 }),
    ).toBe(2.75);
  });

  it("falls back to the property's assignedCleaningHours (decimal) when the job has none", () => {
    expect(
      resolveExpectedHours({ jobType: "AIRBNB_TURNOVER", estimatedHours: null }, { assignedCleaningHours: 2.75 }),
    ).toBe(2.75);
  });

  it("falls back to cleaningDurationMinutes/60 when neither hours field is set", () => {
    expect(
      resolveExpectedHours(
        { jobType: "AIRBNB_TURNOVER", estimatedHours: null },
        { assignedCleaningHours: null, cleaningDurationMinutes: 165 },
      ),
    ).toBeCloseTo(2.75, 5);
  });

  it("returns null when nothing is configured", () => {
    expect(resolveExpectedHours({ jobType: "REGULAR_MAINTENANCE" }, {})).toBeNull();
  });
});
