import { describe, expect, it } from "vitest";
import { jobWindow, rankCleanerSuggestions, type SuggestionCandidate, type SuggestionJob } from "@/lib/jobs/cleaner-suggestions";

// Thursday 12 November 2026, 10:00–14:00.
const job: SuggestionJob = { id: "job", dayKey: "2026-11-12", startTime: "10:00", endTime: "14:00", dueTime: null, estimatedHours: null };
const candidate = (overrides: Partial<SuggestionCandidate>): SuggestionCandidate => ({
  id: "x", name: "X", availability: null, otherJobsThatDay: [], priorCleansHere: 0, ...overrides,
});
const fixed = (weekly: Record<string, Array<{ start: string; end: string }>>, dateOverrides = {}) => ({ mode: "FIXED" as const, weekly, dateOverrides });

describe("rankCleanerSuggestions", () => {
  it("ranks assignable cleaners by cleans at this property and states every reason", () => {
    const result = rankCleanerSuggestions(job, [
      candidate({ id: "sam", name: "Sam O.", priorCleansHere: 2, availability: fixed({ "4": [{ start: "09:00", end: "15:00" }] }) }),
      candidate({ id: "jane", name: "Jane C.", priorCleansHere: 12, availability: { mode: "FLEXIBLE", weekly: {}, dateOverrides: {} } }),
      candidate({ id: "new", name: "Nia", priorCleansHere: 0 }),
    ]);
    expect(result.map((row) => row.cleanerId)).toEqual(["jane", "sam", "new"]);
    expect(result[0].reasons).toEqual(["Flexible hours", "Cleaned here 12 times", "No other jobs that day"]);
    expect(result[1].reasons).toEqual(["Free 09:00–15:00", "Cleaned here 2 times", "No other jobs that day"]);
    expect(result[2].reasons).toEqual(["Availability not set", "Has not cleaned here before", "No other jobs that day"]);
    expect(result.every((row) => row.assignable && row.blocker === null)).toBe(true);
  });

  it("blocks a clash with a known time and says until when", () => {
    const [marco] = rankCleanerSuggestions(job, [candidate({
      id: "marco", name: "Marco R.", priorCleansHere: 30,
      otherJobsThatDay: [{ jobId: "other", propertyName: "Manly Loft", startTime: "08:00", endTime: "11:00", dueTime: null, estimatedHours: null }],
    })]);
    expect(marco).toMatchObject({ assignable: false, blocker: { kind: "clash", reason: "Clashes with Manly Loft until 11:00" } });
    expect(marco.reasons[0]).toBe("Clashes with Manly Loft until 11:00");
  });

  it("blocks a day the cleaner is not rostered (leave) and a job outside their hours", () => {
    const [offDay, shortHours] = rankCleanerSuggestions(job, [
      candidate({ id: "off", name: "Off", priorCleansHere: 9, availability: fixed({ "1": [{ start: "08:00", end: "16:00" }] }) }),
      candidate({ id: "short", name: "Short", priorCleansHere: 1, availability: fixed({}, { "2026-11-12": [{ start: "08:00", end: "12:00" }] }) }),
    ]);
    expect(offDay.blocker).toEqual({ kind: "unavailable", reason: "Not available on Thursdays" });
    expect(shortHours.blocker).toEqual({ kind: "unavailable", reason: "Available 08:00–12:00 only" });
    expect([offDay, shortHours].every((row) => !row.assignable)).toBe(true);
  });

  it("lists blocked cleaners after every assignable one, within their own limit", () => {
    const blocked = Array.from({ length: 5 }, (_, index) => candidate({
      id: `b${index}`, name: `Blocked ${index}`, priorCleansHere: 100 - index,
      otherJobsThatDay: [{ jobId: "o", propertyName: "Elsewhere", startTime: "09:00", endTime: "12:00", dueTime: null, estimatedHours: null }],
    }));
    const free = Array.from({ length: 7 }, (_, index) => candidate({ id: `f${index}`, name: `Free ${index}`, priorCleansHere: index }));
    const result = rankCleanerSuggestions(job, [...blocked, ...free]);
    expect(result.slice(0, 5).every((row) => row.assignable)).toBe(true);
    expect(result.slice(5).map((row) => row.cleanerId)).toEqual(["b0", "b1", "b2"]);
    expect(result[0].cleanerId).toBe("f6");
  });

  it("never invents times: unknown windows warn instead of clashing", () => {
    const untimed: SuggestionJob = { ...job, startTime: null, endTime: null };
    const [row] = rankCleanerSuggestions(untimed, [candidate({
      id: "a", name: "A", availability: fixed({ "4": [{ start: "09:00", end: "10:00" }] }),
      otherJobsThatDay: [{ jobId: "o", propertyName: "Manly Loft", startTime: "10:00", endTime: "12:00", dueTime: null, estimatedHours: null }],
    })]);
    expect(row.assignable).toBe(true);
    expect(row.reasons).toEqual(["Available 09:00–10:00 (job time not set)", "Has not cleaned here before", "Also booked at Manly Loft that day (times not set)"]);
    expect(jobWindow({ startTime: "10:00", endTime: null, dueTime: null, estimatedHours: 2.5 })).toEqual({ start: 600, end: 750 });
    expect(jobWindow({ startTime: "10:00", endTime: null, dueTime: null, estimatedHours: null })).toBeNull();
  });

  it("treats back-to-back jobs as no clash and prefers a lighter day on a tie", () => {
    const back = { jobId: "o", propertyName: "Earlier", startTime: "07:00", endTime: "10:00", dueTime: null, estimatedHours: null };
    const result = rankCleanerSuggestions(job, [
      candidate({ id: "busy", name: "Busy", priorCleansHere: 3, otherJobsThatDay: [back] }),
      candidate({ id: "light", name: "Light", priorCleansHere: 3 }),
    ]);
    expect(result.map((row) => row.cleanerId)).toEqual(["light", "busy"]);
    expect(result[1]).toMatchObject({ assignable: true, reasons: ["Availability not set", "Cleaned here 3 times", "1 other job that day, no overlap"] });
  });
});
