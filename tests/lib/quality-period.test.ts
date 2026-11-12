import { describe, expect, it } from "vitest";
import {
  deltaVsPrevious,
  periodQuery,
  previousRange,
  rangeFromKeys,
  resolveQualityPeriod,
  resolveQualityPeriodLenient,
  isQualityQueryError,
} from "@/lib/quality/period";
import { legacyAccountabilityPeriod } from "@/lib/quality/legacy";

// 2026-11-11 09:30 in Sydney (UTC+11 in November).
const NOW = new Date("2026-11-10T22:30:00Z");

describe("Quality period helper", () => {
  it("counts fixed periods in Sydney days, today included, with an equal previous period", () => {
    const period = resolveQualityPeriod({ period: "7d" }, NOW);
    expect(period).toMatchObject({ key: "7d", fromKey: "2026-11-05", toKey: "2026-11-11", days: 7 });
    // Sydney midnight boundaries, end exclusive.
    expect(period.start?.toISOString()).toBe("2026-11-04T13:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-11-11T13:00:00.000Z");
    expect(period.previous).toMatchObject({ fromKey: "2026-10-29", toKey: "2026-11-04", days: 7 });
  });

  it("defaults to 30 days and refuses an unknown period key", () => {
    expect(resolveQualityPeriod({}, NOW)).toMatchObject({ key: "30d", fromKey: "2026-10-13", toKey: "2026-11-11", days: 30 });
    expect(() => resolveQualityPeriod({ period: "45d" }, NOW)).toThrow(/Unknown period/);
    try {
      resolveQualityPeriod({ period: "45d" }, NOW);
    } catch (error) {
      expect(isQualityQueryError(error)).toBe(true);
    }
  });

  it("reads a custom range inclusively and gives it an equal-length previous range", () => {
    const period = resolveQualityPeriod({ period: "custom", from: "2026-11-01", to: "2026-11-07" }, NOW);
    expect(period).toMatchObject({ key: "custom", fromKey: "2026-11-01", toKey: "2026-11-07", days: 7 });
    expect(period.previous).toMatchObject({ fromKey: "2026-10-25", toKey: "2026-10-31", days: 7 });
  });

  it("treats a from/to pair without a key as custom (old issue links) and an end-only range as open", () => {
    expect(resolveQualityPeriod({ from: "2026-11-02", to: "2026-11-03" }, NOW)).toMatchObject({ key: "custom", days: 2 });
    const open = resolveQualityPeriod({ to: "2026-11-03" }, NOW);
    expect(open).toMatchObject({ key: "custom", fromKey: null, start: null, days: null, previous: null });
    const fromOnly = resolveQualityPeriod({ from: "2026-11-09" }, NOW);
    expect(fromOnly).toMatchObject({ fromKey: "2026-11-09", toKey: "2026-11-11", days: 3 });
  });

  it("refuses impossible or reversed custom ranges, and the lenient reader falls back to 30 days", () => {
    expect(() => resolveQualityPeriod({ period: "custom", from: "2026-02-30", to: "2026-03-01" }, NOW)).toThrow(/yyyy-MM-dd/);
    expect(() => resolveQualityPeriod({ period: "custom", from: "2026-11-08", to: "2026-11-01" }, NOW)).toThrow(/starts after/);
    expect(() => resolveQualityPeriod({ period: "custom" }, NOW)).toThrow(/from or to/);
    expect(resolveQualityPeriodLenient({ period: "custom", from: "nope" }, NOW).key).toBe("30d");
  });

  it("keeps day boundaries right across the daylight-saving change", () => {
    // Sydney moved to UTC+11 on 2026-10-04.
    const range = rangeFromKeys("2026-10-03", "2026-10-04");
    expect(range.start?.toISOString()).toBe("2026-10-02T14:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-04T13:00:00.000Z");
    expect(previousRange(range)).toMatchObject({ fromKey: "2026-10-01", toKey: "2026-10-02" });
  });

  it("states a change only when the previous period has data", () => {
    expect(deltaVsPrevious(88, 86, 12)).toBe(2);
    expect(deltaVsPrevious(88, null, 0)).toBeNull();
    expect(deltaVsPrevious(88, 86, 0)).toBeNull();
    expect(deltaVsPrevious(null, 86, 5)).toBeNull();
    expect(deltaVsPrevious(85.2, 86, 5)).toBe(-0.8);
  });

  it("serialises the period for links", () => {
    expect(periodQuery({ key: "90d", fromKey: "x", toKey: "y" })).toEqual({ period: "90d" });
    expect(periodQuery({ key: "custom", fromKey: null, toKey: "2026-11-03" })).toEqual({ period: "custom", to: "2026-11-03" });
  });

  it("keeps the classic routes' leniency: anything but 7d/90d reads as 30 days", () => {
    expect(legacyAccountabilityPeriod("7d", NOW).days).toBe(7);
    expect(legacyAccountabilityPeriod("90d", NOW).days).toBe(90);
    expect(legacyAccountabilityPeriod("bogus", NOW).days).toBe(30);
    expect(legacyAccountabilityPeriod(null, NOW).days).toBe(30);
  });
});
