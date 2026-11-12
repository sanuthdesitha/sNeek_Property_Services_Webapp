import { describe, expect, it } from "vitest";
import { deriveJobFact, type FactContext, type JobFact } from "@/lib/insights/job-facts";
import { moneyFigures } from "@/lib/insights/aggregate";
import { propertyRows } from "@/lib/insights/entities";
import { detectPropertyOverruns, LOW_MARGIN_MAX_PCT, moneyPerCleanSentence } from "@/lib/insights/findings";
import {
  MARGIN_DANGER_MAX_PCT,
  MARGIN_SUCCESS_FROM_PCT,
  MARGIN_WARNING_BELOW_PCT,
  marginBand,
} from "@/lib/insights/margin-band";
import { buildMeasure, MIN_BASIS_ROW } from "@/lib/insights/measure";
import { comparisonLabel } from "@/lib/insights/period";
import {
  orderPropertyRows,
  previewDefaultOrder,
  previewPropertyRows,
  PROPERTY_PREVIEW_ROWS,
  type PropertyOrder,
} from "@/lib/insights/property-order";
import { allowedSorts, PROPERTY_SORTS, propertySortValue } from "@/lib/insights/sort";
import type { HoursFigures } from "@/lib/insights/types";
import { context, jobRow } from "./insights-fixtures";

const span = { fromKey: "2026-10-01", toKey: "2026-10-31" };
const fact = (overrides: Parameters<typeof jobRow>[0] = {}, ctx: FactContext = context) => deriveJobFact(jobRow(overrides), ctx);
const noIssues = { total: 0, byProperty: new Map<string, number>(), byCleaner: new Map<string, number>(), byCategory: new Map<string, number>() };

function overrunHours(basis: number): HoursFigures {
  const measure = buildMeasure(120, basis, {}, 1);
  return { plannedHours: measure, actualHours: measure, ratio: measure, overruns: basis, averageOverMinutes: 38 };
}

describe("money per clean (overrun finding)", () => {
  it("is (revenue − cleaner cost) ÷ cleans over cleans where both are known, with that basis", () => {
    const complete = Array.from({ length: 3 }, (_, i) => fact({ id: `c${i}` }));
    const noCost = fact({ id: "nc", assignments: [{ userId: "cleaner-1", payRate: null, removedAt: null, user: null }] });
    const noRate = fact({ id: "nr" }, { ...context, rates: { propertyRates: [], priceBook: [] } });
    const money = moneyFigures([...complete, noCost, noRate], MIN_BASIS_ROW);
    // $150 charge − $90 pay on each of the three complete cleans; the half-known ones are excluded, not zero.
    expect(money.marginPerClean).toMatchObject({ value: 60, basisCount: 3, excludedCount: 2, excluded: { no_pay_rate: 1, no_client_rate: 1 } });
  });

  it("withholds the number below the minimum basis", () => {
    const money = moneyFigures([fact({ id: "a" }), fact({ id: "b" })], MIN_BASIS_ROW);
    expect(money.marginPerClean).toMatchObject({ value: null, enough: false, basisCount: 2 });
  });

  it("states the drawn sentence for a property running over, with the basis count", () => {
    const [finding] = detectPropertyOverruns(
      [{ propertyId: "p1", propertyName: "Glebe House", hours: overrunHours(9), marginPerClean: buildMeasure(11.4, 9, {}, MIN_BASIS_ROW) }],
      span,
    );
    expect(finding.detail).toBe("9 of 9 cleans went over. At the current rate this property makes $11 per clean.");
    expect(finding.basis).toContain("Per clean: revenue less cleaner pay, over 9 cleans with both.");
  });

  it("says loses for a negative margin, and gives no number when there is not enough data", () => {
    expect(moneyPerCleanSentence(buildMeasure(-24.5, 5, {}, 3)).detail).toBe("At the current rate this property loses $25 per clean.");
    const thin = moneyPerCleanSentence(buildMeasure(40, 2, {}, MIN_BASIS_ROW));
    expect(thin.detail).toBe("Money per clean: not enough data.");
    expect(thin.detail).not.toMatch(/\$/);
    expect(thin.basis).toContain("2 cleans with both");
  });

  it("leaves the money sentence out entirely without finance access (no measure passed)", () => {
    const [finding] = detectPropertyOverruns([{ propertyId: "p1", propertyName: "Glebe House", hours: overrunHours(9) }], span);
    expect(finding.detail).toBe("9 of 9 cleans went over.");
    expect(`${finding.detail} ${finding.basis}`).not.toMatch(/per clean|\$/);
  });
});

describe("margin badge bands", () => {
  it("follows the named thresholds, with the danger band ending at the low-margin floor", () => {
    expect(MARGIN_DANGER_MAX_PCT).toBe(LOW_MARGIN_MAX_PCT);
    expect(marginBand(7)).toBe("danger");
    expect(marginBand(MARGIN_DANGER_MAX_PCT)).toBe("danger");
    expect(marginBand(MARGIN_DANGER_MAX_PCT + 0.1)).toBe("warning");
    expect(marginBand(24)).toBe("warning");
    expect(marginBand(MARGIN_WARNING_BELOW_PCT)).toBe("neutral");
    expect(marginBand(39)).toBe("neutral");
    expect(marginBand(MARGIN_SUCCESS_FROM_PCT - 0.1)).toBe("neutral");
    expect(marginBand(MARGIN_SUCCESS_FROM_PCT)).toBe("success");
    expect(marginBand(48)).toBe("success");
    expect(marginBand(-12)).toBe("danger");
  });
});

/** Eight properties with different clean counts, charges, pay and logged time; one without a rate. */
function portfolio(): JobFact[] {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const ctx: FactContext = {
    ...context,
    rates: {
      propertyRates: ids
        .filter((id) => id !== "p8")
        .map((id, i) => ({ propertyId: id, jobType: "AIRBNB_TURNOVER" as const, baseCharge: 120 + i * 17, defaultDescription: null })),
      priceBook: [],
    },
  };
  const facts: JobFact[] = [];
  ids.forEach((propertyId, p) => {
    const cleans = 3 + ((p * 5) % 4);
    for (let c = 0; c < cleans; c += 1) {
      const minutes = 150 + ((p * 37 + c * 11) % 90);
      facts.push(
        fact(
          {
            id: `${propertyId}-${c}`,
            propertyId,
            property: { name: `Property ${String.fromCharCode(72 - p)}`, clientId: "client-1", client: { name: "Northside Lets" } },
            assignments: [{ userId: "cleaner-1", payRate: 25 + ((p * 3) % 10), removedAt: null, user: { name: "Ana", email: null, role: "CLEANER", hourlyRate: null } }],
            timeLogs: [{ userId: "cleaner-1", startedAt: new Date("2026-10-04T23:05:00Z"), stoppedAt: new Date("2026-10-05T02:25:00Z"), durationM: minutes }],
            qaReviews: c % 2 ? [] : [{ score: 70 + p * 3, kind: "QA", rating: null, managementReview: false, createdAt: new Date("2026-10-06T00:00:00Z") }],
          },
          ctx,
        ),
      );
    }
  });
  return facts;
}

describe("the five-row preview sorted in place", () => {
  const rows = propertyRows(portfolio(), noIssues, span, true);

  /** Independent check: every row in the top five ranks no worse than every row left out. */
  function assertTrueTopFive(order: PropertyOrder) {
    const top = previewPropertyRows(rows, order);
    expect(top).toHaveLength(PROPERTY_PREVIEW_ROWS);
    expect(top).toEqual(orderPropertyRows(rows, order).slice(0, PROPERTY_PREVIEW_ROWS));
    const rest = rows.filter((row) => !top.some((picked) => picked.id === row.id));
    const factor = order.dir === "asc" ? 1 : -1;
    for (const picked of top) {
      const a = propertySortValue(picked, order.sort);
      for (const other of rest) {
        const b = propertySortValue(other, order.sort);
        if (a === null) expect(b).toBeNull();
        else if (b !== null) expect((a < b ? -1 : a > b ? 1 : 0) * factor).toBeLessThanOrEqual(0);
      }
    }
  }

  it("returns the true top five of the whole set for every column and direction", () => {
    for (const sort of allowedSorts(PROPERTY_SORTS, true)) {
      assertTrueTopFive({ sort, dir: "asc" });
      assertTrueTopFive({ sort, dir: "desc" });
    }
  });

  it("puts a property with no margin last, never as a zero", () => {
    const byMargin = orderPropertyRows(rows, { sort: "margin", dir: "asc" });
    expect(byMargin[byMargin.length - 1].id).toBe("p8");
    expect(previewPropertyRows(rows, { sort: "margin", dir: "asc" }).map((row) => row.id)).not.toContain("p8");
  });

  it("defaults to least profitable first with finance, and most over plan without", () => {
    expect(previewDefaultOrder({ finance: true })).toEqual({ sort: "margin", dir: "asc" });
    expect(previewDefaultOrder({ finance: false })).toEqual({ sort: "ratio", dir: "desc" });
    expect(allowedSorts(PROPERTY_SORTS, false)).not.toContain("margin");
    expect(allowedSorts(PROPERTY_SORTS, false)).toContain("ratio");
  });
});

describe("subtitle comparison", () => {
  it("names a whole month in the same year without the year, as drawn", () => {
    const current = { fromKey: "2026-10-01", toKey: "2026-10-31" };
    expect(comparisonLabel(current, { fromKey: "2026-09-01", toKey: "2026-09-30" })).toBe("September");
    expect(comparisonLabel({ fromKey: "2026-01-01", toKey: "2026-01-31" }, { fromKey: "2025-12-01", toKey: "2025-12-31" })).toBe("December 2025");
    expect(comparisonLabel(current, { fromKey: "2026-09-10", toKey: "2026-09-30" })).toBe("10 Sep – 30 Sep 2026");
  });
});
