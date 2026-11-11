import { describe, expect, it } from "vitest";
import { deriveJobFact, scheduledStart } from "@/lib/insights/job-facts";
import { hoursFigures, moneyFigures, onTimeMeasure, summarise } from "@/lib/insights/aggregate";
import { buildMeasure, computeDelta, countMeasure, MIN_BASIS_SUMMARY, withDelta } from "@/lib/insights/measure";
import { businessCards } from "@/lib/insights/business";
import { daysToPay, daysToPayMeasure } from "@/lib/insights/receivables";
import { basisText } from "@/lib/insights/format";
import { context, jobRow } from "./insights-fixtures";

const fact = (overrides: Parameters<typeof jobRow>[0] = {}) => deriveJobFact(jobRow(overrides), context);

describe("one clean with complete data", () => {
  it("derives charge, recorded pay, planned and logged time, on time and the authoritative score", () => {
    const f = fact();
    expect(f.charge).toEqual({ value: 150, reason: null });
    expect(f.cost).toEqual({ value: 90, reason: null });
    expect(f.plannedMinutes).toEqual({ value: 180, reason: null });
    expect(f.actualMinutes).toEqual({ value: 200, reason: null });
    expect(f.onTime).toEqual({ value: true, reason: null });
    expect(f.review?.score).toBe(90);
    expect(f.dayKey).toBe("2026-10-05");
    expect(f.weekKey).toBe("2026-10-05");
  });

  it("adds approved adjustments to recorded pay and ignores pending ones", () => {
    const f = fact({
      payAdjustments: [
        { id: "a1", cleanerId: "cleaner-1", status: "APPROVED", requestedAmount: 10, approvedAmount: 12 },
        { id: "a2", cleanerId: "cleaner-1", status: "PENDING", requestedAmount: 50, approvedAmount: null },
      ],
    });
    expect(f.cost).toEqual({ value: 102, reason: null });
  });

  it("is late when the first clock-in is more than 15 minutes after the Sydney start", () => {
    const late = fact({ timeLogs: [{ userId: "cleaner-1", startedAt: new Date("2026-10-04T23:16:00Z"), stoppedAt: new Date("2026-10-05T02:00:00Z"), durationM: 164 }] });
    expect(late.onTime).toEqual({ value: false, reason: null });
    const edge = fact({ timeLogs: [{ userId: "cleaner-1", startedAt: new Date("2026-10-04T23:15:00Z"), stoppedAt: new Date("2026-10-05T02:00:00Z"), durationM: 165 }] });
    expect(edge.onTime.value).toBe(true);
    expect(scheduledStart("2026-10-05", "10:00")?.toISOString()).toBe("2026-10-04T23:00:00.000Z");
  });
});

describe("missing inputs are excluded and counted, never zero", () => {
  it("no client rate → no charge", () => {
    const f = deriveJobFact(jobRow(), { ...context, rates: { propertyRates: [], priceBook: [] } });
    expect(f.charge).toEqual({ value: null, reason: "no_client_rate" });
  });

  it("a skipped clean is not billed", () => {
    expect(fact({ cleanSkipStatus: "SKIPPED" }).charge.reason).toBe("skipped_clean");
  });

  it("no pay rate anywhere → no cost (no default-rate fallback)", () => {
    const f = fact({ assignments: [{ userId: "cleaner-1", payRate: null, removedAt: null, user: { name: "Ana", email: null, role: "CLEANER", hourlyRate: null } }] });
    expect(f.cost).toEqual({ value: null, reason: "no_pay_rate" });
  });

  it("no cleaner → no cost; no allocated hours and no log → nothing to pay from", () => {
    expect(fact({ assignments: [] }).cost.reason).toBe("no_cleaner");
    expect(fact({ estimatedHours: null, timeLogs: [] }).cost.reason).toBe("no_paid_hours");
  });

  it("no time log, an open log, or a cleaner without a log → no actual time", () => {
    expect(fact({ timeLogs: [] }).actualMinutes.reason).toBe("no_time_log");
    expect(fact({ timeLogs: [{ userId: "cleaner-1", startedAt: new Date("2026-10-04T23:00:00Z"), stoppedAt: null, durationM: null }] }).actualMinutes.reason).toBe("time_log_open");
    const twoCleaners = fact({
      assignments: [
        { userId: "cleaner-1", payRate: 30, removedAt: null, user: null },
        { userId: "cleaner-2", payRate: 30, removedAt: null, user: null },
      ],
    });
    expect(twoCleaners.actualMinutes.reason).toBe("no_time_log");
    expect(twoCleaners.shares.map((share) => share.plannedMinutes.value)).toEqual([90, 90]);
  });

  it("no start time → on time unknown; no allocated time → planned unknown", () => {
    expect(fact({ startTime: null }).onTime.reason).toBe("no_start_time");
    expect(fact({ estimatedHours: 0 }).plannedMinutes.reason).toBe("no_planned_time");
  });
});

describe("aggregates", () => {
  const complete = Array.from({ length: 5 }, (_, index) => fact({ id: `job-${index}` }));

  it("computes every measure with complete data", () => {
    const figures = summarise(complete, { minBasis: MIN_BASIS_SUMMARY, money: true, issues: 2 });
    expect(figures.cleans).toBe(5);
    expect(figures.money?.revenue).toMatchObject({ value: 750, basisCount: 5, excludedCount: 0, enough: true });
    expect(figures.money?.cleanerCost.value).toBe(450);
    expect(figures.money?.margin.value).toBe(40);
    expect(figures.hours.plannedHours.value).toBe(15);
    expect(figures.hours.actualHours.value).toBe(16.7);
    expect(figures.hours.ratio.value).toBe(111.1);
    expect(figures.hours.overruns).toBe(5);
    expect(figures.hours.averageOverMinutes).toBe(20);
    expect(figures.onTime.value).toBe(100);
    expect(figures.qaScore.value).toBe(90);
    expect(figures.issues).toBe(2);
    expect(figures.reworkRate.value).toBe(0);
  });

  it("excludes and counts records missing an input, with the reason on screen", () => {
    const facts = [...complete, fact({ id: "x1", timeLogs: [] }), fact({ id: "x2", timeLogs: [] })];
    const hours = hoursFigures(facts, MIN_BASIS_SUMMARY);
    expect(hours.ratio).toMatchObject({ basisCount: 5, excludedCount: 2, excluded: { no_time_log: 2 } });
    expect(basisText(hours.ratio)).toBe("5 of 7 cleans; 2 excluded: no time log (2)");
    expect(onTimeMeasure(facts, MIN_BASIS_SUMMARY)).toMatchObject({ value: 100, basisCount: 5, excludedCount: 2 });
  });

  it("computes margin only over cleans where both revenue and cost are known", () => {
    const noCost = fact({ id: "nc", assignments: [{ userId: "cleaner-1", payRate: null, removedAt: null, user: null }] });
    const noRate = deriveJobFact(jobRow({ id: "nr" }), { ...context, rates: { propertyRates: [], priceBook: [] } });
    const money = moneyFigures([...complete, noCost, noRate], MIN_BASIS_SUMMARY);
    expect(money.revenue).toMatchObject({ value: 900, basisCount: 6, excludedCount: 1 });
    expect(money.cleanerCost).toMatchObject({ value: 540, basisCount: 6, excludedCount: 1 });
    // (750 − 450) / 750 over the five complete cleans; the half-known cleans do not distort it.
    expect(money.margin).toMatchObject({ value: 40, basisCount: 5, excludedCount: 2, excluded: { no_pay_rate: 1, no_client_rate: 1 } });
  });

  it("withholds a figure below the minimum basis: no number, a reason", () => {
    const money = moneyFigures(complete.slice(0, MIN_BASIS_SUMMARY - 1), MIN_BASIS_SUMMARY);
    expect(money.revenue).toMatchObject({ value: null, enough: false, basisCount: 4 });
    expect(money.revenue.reason).toMatch(/Not enough data/);
    const none = buildMeasure(null, 0, { no_time_log: 3 }, MIN_BASIS_SUMMARY);
    expect(none.value).toBeNull();
    expect(none.reason).toMatch(/no time log \(3\)/);
  });

  it("states a change only when both periods have enough data", () => {
    const enough = buildMeasure(40, 10, {}, 5);
    const thin = buildMeasure(30, 2, {}, 5);
    expect(computeDelta(enough, buildMeasure(35, 10, {}, 5), "points")).toBe(5);
    expect(computeDelta(enough, thin, "points")).toBeNull();
    expect(computeDelta(thin, enough, "points")).toBeNull();
    expect(computeDelta(enough, null, "points")).toBeNull();
    expect(computeDelta(buildMeasure(110, 10, {}, 5), buildMeasure(100, 10, {}, 5), "percent")).toBe(10);
    expect(computeDelta(buildMeasure(10, 10, {}, 5), buildMeasure(0, 10, {}, 5), "percent")).toBeNull();
    expect(withDelta(countMeasure(14), countMeasure(10), "count").delta).toBe(4);
  });

  it("business cards drop the change without a previous period and omit money without finance", () => {
    const current = summarise(complete, { minBasis: MIN_BASIS_SUMMARY, money: false, issues: 0 });
    const cards = businessCards(current, null);
    expect(cards.revenue).toBeUndefined();
    expect(cards.margin).toBeUndefined();
    expect(cards.cleans).toMatchObject({ value: 5, delta: null, previous: null });
  });

  it("counts rework jobs against cleans", () => {
    const facts = [...complete, fact({ id: "rw", isRework: true })];
    expect(summarise(facts, { minBasis: MIN_BASIS_SUMMARY, money: false, issues: 0 }).reworkRate.value).toBe(16.7);
  });
});

describe("days to pay", () => {
  it("counts Sydney days from sent to paid and excludes invoices without a sent date", () => {
    expect(daysToPay(new Date("2026-10-01T01:00:00Z"), new Date("2026-10-15T23:00:00Z"))).toEqual({ value: 15, reason: null });
    expect(daysToPay(null, new Date("2026-10-15T00:00:00Z"))).toEqual({ value: null, reason: "no_sent_date" });
    const measure = daysToPayMeasure(
      [
        { clientId: "c", days: { value: 10, reason: null } },
        { clientId: "c", days: { value: 20, reason: null } },
        { clientId: "c", days: { value: null, reason: "no_sent_date" } },
      ],
      1,
    );
    expect(measure).toMatchObject({ value: 15, basisCount: 2, excludedCount: 1 });
  });
});
