import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CleanerTimingSummary } from "@/components/v2/cleaner/timing-summary";
import { TimingRuleBanners } from "@/components/v2/cleaner/job-stages/timing-banner";
import { summarizeTiming, validTimingTime } from "@/lib/jobs/timing-summary";

describe("cleaner timing summary", () => {
  it("does not replace an invalid early override with a later standard arrival", () => {
    const input = { timingBadges: { early: "25:00" }, sameDayCheckin: true, sameDayCheckinTime: "15:00" };
    expect(summarizeTiming(input).arrival).toEqual({ time: null, sameDay: true, early: true });
    render(<CleanerTimingSummary {...input} />);
    expect(screen.getByText("Early check-in: Arrival time not confirmed")).toBeVisible();
    expect(screen.queryByText(/Ready by 15:00/)).toBeNull();
  });
  it("keeps detail banners consistent for invalid guest timing", () => {
    render(<TimingRuleBanners rules={{ earlyCheckin: { time: "25:00" }, lateCheckout: { time: "12:90" } }} />);
    expect(screen.getByRole("note")).toHaveTextContent("Some timing information is invalid.");
    expect(screen.queryByText(/25:00|12:90/)).toBeNull();
  });
  it.each(["24:00", "10:60", "9:30", "10:00oops", "", null, undefined])("rejects invalid clock %s", value => {
    expect(validTimingTime(value)).toBeNull();
  });
  it.each(["00:00", "23:59", "10:30"])("accepts %s", value => {
    expect(validTimingTime(` ${value} `)).toBe(value);
  });
  it("prioritizes explicit early check-in over standard same-day arrival", () => {
    const result = summarizeTiming({ timingBadges: { early: "13:00" }, sameDayCheckin: true, sameDayCheckinTime: "15:00" });
    expect(result.guestDeadline).toBe("13:00");
    expect(result.arrival?.early).toBe(true);
  });
  it("reports contradictory start, finish and access windows without changing them", () => {
    const result = summarizeTiming({ startTime: "10:00", dueTime: "14:00", timingBadges: { late: "13:00", early: "13:00" } });
    expect(result.warnings).toHaveLength(3);
    expect(result.plannedStart).toBe("10:00");
    expect(result.plannedFinish).toBe("14:00");
  });
  it("does not invent a deadline for an unknown arrival", () => {
    render(<CleanerTimingSummary sameDayCheckin />);
    expect(screen.getByText(/Arrival time not confirmed/)).toBeVisible();
    expect(screen.queryByText(/Ready by/)).toBeNull();
  });
  it("separates planned times from guest constraints and exposes conflicts", () => {
    render(<CleanerTimingSummary startTime="10:00" dueTime="13:00" timingBadges={{ late: "10:30", early: "13:00" }} />);
    expect(screen.getByText("Planned start: 10:00")).toBeVisible();
    expect(screen.getByText("Late checkout: Start after 10:30")).toBeVisible();
    expect(screen.getByText("Early check-in: Ready by 13:00")).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("Planned start is before");
  });
  it("does not infer an overnight conflict from planned times alone", () => {
    expect(summarizeTiming({ startTime: "23:00", dueTime: "01:00" }).warnings).toEqual([]);
  });
  it("reports malformed supplied timing instead of presenting it as a deadline", () => {
    const result = summarizeTiming({ timingBadges: { early: "25:00" } });
    expect(result.guestDeadline).toBeNull();
    expect(result.warnings).toContain("Some timing information is invalid.");
  });
});
