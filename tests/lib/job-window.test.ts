import { describe, it, expect } from "vitest";
import { formatStartWindow, resolveExpectedHours } from "@/lib/jobs/window";

describe("formatStartWindow", () => {
  it("builds a turnover window from the job's start/due times", () => {
    expect(
      formatStartWindow(
        { jobType: "AIRBNB_TURNOVER", startTime: "11:00", dueTime: "14:00" },
        {}
      )
    ).toBe("Start after 11:00 · finish before 14:00");
  });

  it("falls back to property defaults, then hardcoded 10:00/15:00, for turnovers", () => {
    // Property defaults fill the gaps when the job has no times.
    expect(
      formatStartWindow(
        { jobType: "AIRBNB_TURNOVER" },
        { defaultCheckoutTime: "10:30", defaultCheckinTime: "16:00" }
      )
    ).toBe("Start after 10:30 · finish before 16:00");

    // Nothing set anywhere → 10:00 / 15:00 fallbacks.
    expect(formatStartWindow({ jobType: "AIRBNB_TURNOVER" }, {})).toBe(
      "Start after 10:00 · finish before 15:00"
    );
  });

  it("returns the plain start time for non-turnover jobs", () => {
    expect(
      formatStartWindow({ jobType: "DEEP_CLEAN", startTime: "09:00" }, {})
    ).toBe("09:00");
  });

  it("returns null for a non-turnover job with no start time", () => {
    expect(formatStartWindow({ jobType: "GENERAL_CLEAN" }, {})).toBeNull();
    expect(formatStartWindow({ jobType: "GENERAL_CLEAN", startTime: null }, {})).toBeNull();
  });
});

describe("resolveExpectedHours", () => {
  it("prefers the job's own estimatedHours", () => {
    expect(
      resolveExpectedHours({ jobType: "AIRBNB_TURNOVER", estimatedHours: 2.5 }, { cleaningDurationMinutes: 180 })
    ).toBe(2.5);
  });

  it("falls back to the property's cleaningDurationMinutes in hours", () => {
    expect(
      resolveExpectedHours({ jobType: "AIRBNB_TURNOVER" }, { cleaningDurationMinutes: 150 })
    ).toBe(2.5);
  });

  it("returns null when neither source is set", () => {
    expect(resolveExpectedHours({ jobType: "AIRBNB_TURNOVER" }, {})).toBeNull();
    expect(
      resolveExpectedHours({ jobType: "AIRBNB_TURNOVER" }, { cleaningDurationMinutes: null })
    ).toBeNull();
  });

  it("uses estimatedHours of 0 rather than falling through (nullish precedence)", () => {
    expect(
      resolveExpectedHours({ jobType: "AIRBNB_TURNOVER", estimatedHours: 0 }, { cleaningDurationMinutes: 180 })
    ).toBe(0);
  });
});
