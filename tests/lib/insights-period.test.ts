import { describe, expect, it } from "vitest";
import {
  InsightsQueryError,
  MAX_PERIOD_DAYS,
  periodPayload,
  rangeLabel,
  resolveInsightsPeriod,
  resolveInsightsPeriodLenient,
} from "@/lib/insights/period";
import { previousRange, rangeFromKeys } from "@/lib/quality/period";

// 2026-11-11 10:00 in Sydney (AEDT, UTC+11).
const NOW = new Date("2026-11-10T23:00:00Z");

describe("Insights period presets (Sydney days)", () => {
  it("this month runs from the 1st to today, compared with the same days of last month", () => {
    const period = resolveInsightsPeriod({ period: "this-month" }, NOW);
    expect([period.fromKey, period.toKey, period.days]).toEqual(["2026-11-01", "2026-11-11", 11]);
    expect([period.previous?.fromKey, period.previous?.toKey]).toEqual(["2026-10-01", "2026-10-11"]);
    expect(period.start.toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-11-11T13:00:00.000Z");
  });

  it("last month is the whole previous calendar month, compared with the month before", () => {
    const period = resolveInsightsPeriod({ period: "last-month" }, NOW);
    expect([period.fromKey, period.toKey, period.days]).toEqual(["2026-10-01", "2026-10-31", 31]);
    expect([period.previous?.fromKey, period.previous?.toKey]).toEqual(["2026-09-01", "2026-09-30"]);
    expect(rangeLabel(period)).toBe("October 2026");
    expect(periodPayload(period).previous?.label).toBe("September 2026");
  });

  it("is the default", () => {
    expect(resolveInsightsPeriod({}, NOW).key).toBe("last-month");
  });

  it("quarter is quarter to date, compared with the same number of days of the previous quarter", () => {
    const period = resolveInsightsPeriod({ period: "quarter" }, NOW);
    expect([period.fromKey, period.toKey, period.days]).toEqual(["2026-10-01", "2026-11-11", 42]);
    expect([period.previous?.fromKey, period.previous?.toKey]).toEqual(["2026-07-01", "2026-08-11"]);
  });

  it("uses the Sydney day, not the UTC day, at a month boundary", () => {
    // 2026-10-31 13:30 UTC is already 1 November in Sydney.
    const boundary = new Date("2026-10-31T13:30:00Z");
    expect(resolveInsightsPeriod({ period: "this-month" }, boundary).fromKey).toBe("2026-11-01");
    expect(resolveInsightsPeriod({ period: "last-month" }, boundary).fromKey).toBe("2026-10-01");
    // One hour earlier it is still 31 October in Sydney.
    const before = new Date("2026-10-31T12:30:00Z");
    expect(resolveInsightsPeriod({ period: "this-month" }, before).fromKey).toBe("2026-10-01");
  });

  it("clamps this month's comparison to the end of a shorter previous month", () => {
    const march31 = new Date("2026-03-31T02:00:00Z");
    const period = resolveInsightsPeriod({ period: "this-month" }, march31);
    expect([period.fromKey, period.toKey]).toEqual(["2026-03-01", "2026-03-31"]);
    expect([period.previous?.fromKey, period.previous?.toKey]).toEqual(["2026-02-01", "2026-02-28"]);
  });

  it("last month in January compares December with November across the year", () => {
    const period = resolveInsightsPeriod({ period: "last-month" }, new Date("2027-01-15T00:00:00Z"));
    expect([period.fromKey, period.toKey]).toEqual(["2026-12-01", "2026-12-31"]);
    expect([period.previous?.fromKey, period.previous?.toKey]).toEqual(["2026-11-01", "2026-11-30"]);
  });
});

describe("Insights custom period", () => {
  it("uses the Quality hub's equal-length previous period", () => {
    const period = resolveInsightsPeriod({ period: "custom", from: "2026-10-10", to: "2026-10-19" }, NOW);
    const quality = previousRange(rangeFromKeys("2026-10-10", "2026-10-19"));
    expect([period.previous?.fromKey, period.previous?.toKey]).toEqual([quality?.fromKey, quality?.toKey]);
    expect([period.previous?.fromKey, period.previous?.toKey]).toEqual(["2026-09-30", "2026-10-09"]);
  });

  it("refuses unknown keys, malformed or reversed days, open ranges and over-long periods", () => {
    expect(() => resolveInsightsPeriod({ period: "year" }, NOW)).toThrow(InsightsQueryError);
    expect(() => resolveInsightsPeriod({ period: "custom", from: "2026-02-30", to: "2026-03-01" }, NOW)).toThrow(/yyyy-MM-dd/);
    expect(() => resolveInsightsPeriod({ period: "custom", from: "2026-03-02", to: "2026-03-01" }, NOW)).toThrow(/starts after/);
    expect(() => resolveInsightsPeriod({ period: "custom", to: "2026-03-01" }, NOW)).toThrow(/both/);
    expect(() => resolveInsightsPeriod({ period: "custom", from: "2025-01-01", to: "2026-01-02" }, NOW)).toThrow(String(MAX_PERIOD_DAYS));
    expect(resolveInsightsPeriod({ period: "custom", from: "2025-01-01", to: "2026-01-01" }, NOW).days).toBe(366);
  });

  it("falls back to the default only in the lenient browser reader", () => {
    expect(resolveInsightsPeriodLenient({ period: "nonsense" }, NOW).key).toBe("last-month");
  });
});
