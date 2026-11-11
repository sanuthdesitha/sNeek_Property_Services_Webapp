// @vitest-environment node
import { describe, expect, it } from "vitest";
import { calendarDaysBetween, holdingCutoff, holdingState, zonedDayBoundary } from "@/lib/lost-found/holding";

const TZ = "Australia/Sydney";

describe("holding period in Sydney calendar days", () => {
  // Found 1 Nov 23:30 Sydney (= 1 Nov 12:30Z, AEDT +11).
  const found = new Date("2026-11-01T12:30:00Z");
  it("is not flagged at 14 days and flagged at 15", () => {
    const day14 = new Date("2026-11-15T01:00:00Z"); // 15 Nov 12:00 Sydney
    const day15 = new Date("2026-11-15T13:30:00Z"); // 16 Nov 00:30 Sydney
    expect(holdingState({ status: "IN_STORAGE", foundAt: found, now: day14, timeZone: TZ, holdingDays: 14 })).toEqual({ counts: true, days: 14, past: false });
    expect(holdingState({ status: "IN_STORAGE", foundAt: found, now: day15, timeZone: TZ, holdingDays: 14 })).toEqual({ counts: true, days: 15, past: true });
  });
  it("counts calendar days in Sydney, not UTC days or elapsed hours", () => {
    // 23:30 → 00:30 next Sydney day is one day, though only an hour passed.
    expect(calendarDaysBetween(found, new Date("2026-11-01T13:30:00Z"), TZ)).toBe(1);
    expect(calendarDaysBetween(found, new Date("2026-11-01T12:59:00Z"), TZ)).toBe(0);
  });
  it("only counts items in storage or awaiting the guest", () => {
    const late = new Date("2026-12-31T00:00:00Z");
    for (const status of ["GUEST_CONTACTED", "RETURN_OFFERED"]) expect(holdingState({ status, foundAt: found, now: late, timeZone: TZ, holdingDays: 14 }).past).toBe(true);
    for (const status of ["REPORTED", "DONATED", "ARCHIVED"]) expect(holdingState({ status, foundAt: found, now: late, timeZone: TZ, holdingDays: 14 })).toEqual({ counts: false, days: null, past: false });
  });
  it("the server cutoff agrees with the per-row flag", () => {
    const now = new Date("2026-11-15T13:30:00Z"); // 16 Nov Sydney
    const cutoff = holdingCutoff(now, TZ, 14);
    expect(cutoff.toISOString()).toBe("2026-11-01T13:00:00.000Z"); // 2 Nov 00:00 Sydney
    expect(found < cutoff).toBe(holdingState({ status: "IN_STORAGE", foundAt: found, now, timeZone: TZ, holdingDays: 14 }).past);
    const nextDay = new Date("2026-11-01T13:00:00Z");
    expect(nextDay < cutoff).toBe(false);
    expect(holdingState({ status: "IN_STORAGE", foundAt: nextDay, now, timeZone: TZ, holdingDays: 14 }).past).toBe(false);
  });
  it("reads date filters as Sydney days", () => {
    expect(zonedDayBoundary("2026-11-02", TZ, "start")?.toISOString()).toBe("2026-11-01T13:00:00.000Z");
    expect(zonedDayBoundary("2026-11-02", TZ, "end")?.toISOString()).toBe("2026-11-02T12:59:59.999Z");
    expect(zonedDayBoundary("not-a-day", TZ, "start")).toBeNull();
  });
});
