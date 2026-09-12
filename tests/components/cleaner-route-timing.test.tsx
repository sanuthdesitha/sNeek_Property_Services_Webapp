import { describe, expect, it } from "vitest";
import { simulateRoute, newDeadlineViolation, type RouteStop } from "@/components/v2/cleaner/route-timeline";

const stop: RouteStop = { jobId: "one", jobNumber: 1, status: "ASSIGNED", startTime: "10:00", dueTime: "15:00", estimatedHours: 2, propertyName: "Home", address: "", suburb: "", latitude: null, longitude: null };
describe("route guest timing constraints", () => {
  it("anchors the first stop on known access rather than a later job", () => {
    const [result] = simulateRoute([{ ...stop, startTime: null, timingBadges: { late: "09:00", early: "12:00" } }, { ...stop, jobId: "two", startTime: "14:00" }]);
    expect(result.startMin).toBe(540);
    expect(result.finishMin).toBe(660);
    expect(result.hardDeadline).toBe(false);
  });
  it("detects a newly affected job even if the missed-deadline count is unchanged", () => {
    const first = { ...stop, startTime: "09:00", dueTime: "12:00" };
    const second = { ...first, jobId: "two" };
    expect(newDeadlineViolation(simulateRoute([first, second]), simulateRoute([second, first]))?.jobId).toBe("one");
  });
  it("waits until late checkout even when the planned start is earlier", () => {
    const [result] = simulateRoute([{ ...stop, timingBadges: { late: "11:00" } }]);
    expect(result.startMin).toBe(660);
    expect(result.finishMin).toBe(780);
    expect(result.softWait).toBe(false);
  });
  it("uses an earlier guest deadline instead of the later planned finish", () => {
    expect(simulateRoute([{ ...stop, timingBadges: { early: "11:00" } }])[0].hardDeadline).toBe(true);
  });
  it("preserves an earlier planned deadline", () => {
    expect(simulateRoute([{ ...stop, dueTime: "11:00", sameDayCheckin: true, sameDayCheckinTime: "15:00" }])[0].hardDeadline).toBe(true);
  });
  it("carries waiting time into subsequent stops", () => {
    const results = simulateRoute([{ ...stop, timingBadges: { late: "12:00" } }, { ...stop, jobId: "two", dueTime: "16:00" }]);
    expect(results[1].arrivalMin).toBe(860);
    expect(results[1].hardDeadline).toBe(true);
  });
  it.each([NaN, Infinity, -1, 0])("uses the existing duration fallback for invalid estimate %s", estimatedHours => {
    expect(simulateRoute([{ ...stop, estimatedHours }])[0].finishMin).toBe(720);
  });
});
