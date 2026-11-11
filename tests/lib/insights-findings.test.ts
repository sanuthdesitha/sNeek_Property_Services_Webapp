import { describe, expect, it } from "vitest";
import {
  detectIssueSurges,
  detectLowMargins,
  detectPropertyOverruns,
  detectSlowPayers,
  ISSUE_SURGE_MIN_COUNT,
  LOW_MARGIN_MAX_PCT,
  LOW_MARGIN_MIN_CLEANS,
  OVERRUN_MIN_CLEANS,
  OVERRUN_MIN_MINUTES,
  pickFindings,
  SLOW_PAY_MIN_DAYS_OVER_TERMS,
  SLOW_PAY_MIN_INVOICES,
  type Finding,
} from "@/lib/insights/findings";
import { buildMeasure } from "@/lib/insights/measure";
import type { HoursFigures } from "@/lib/insights/types";

const span = { fromKey: "2026-10-01", toKey: "2026-10-31" };

function hours(averageOverMinutes: number, basis: number, overruns: number): HoursFigures {
  const measure = buildMeasure(110, basis, { no_time_log: 1 }, 1);
  return { plannedHours: measure, actualHours: measure, ratio: measure, overruns, averageOverMinutes };
}

describe("property overrun detector", () => {
  it("fires at the threshold with a templated sentence and a jobs link", () => {
    const [finding] = detectPropertyOverruns(
      [{ propertyId: "p1", propertyName: "Glebe House", hours: hours(OVERRUN_MIN_MINUTES, OVERRUN_MIN_CLEANS, 2) }],
      span,
    );
    expect(finding.headline).toBe(`Glebe House runs ${OVERRUN_MIN_MINUTES} minutes over its allocated time on average.`);
    expect(finding.detail).toBe(`2 of ${OVERRUN_MIN_CLEANS} cleans went over.`);
    expect(finding.basis).toMatch(/1 excluded/);
    expect(finding.link.href).toBe("/v2/admin/jobs?propertyId=p1&dateFrom=2026-10-01&dateTo=2026-10-31");
  });

  it("does not fire below the minutes or the clean count", () => {
    expect(detectPropertyOverruns([{ propertyId: "p", propertyName: "P", hours: hours(OVERRUN_MIN_MINUTES - 1, 9, 9) }], span)).toEqual([]);
    expect(detectPropertyOverruns([{ propertyId: "p", propertyName: "P", hours: hours(60, OVERRUN_MIN_CLEANS - 1, 2) }], span)).toEqual([]);
  });
});

describe("issue surge detector", () => {
  it("fires when a category at least doubles with the minimum count, linking to the filtered issues", () => {
    const [finding] = detectIssueSurges([{ category: "linen", label: "Linen", current: 6, previous: 3 }], span, "September 2026");
    expect(finding.headline).toBe("Linen issues doubled, from 3 to 6.");
    expect(finding.link.href).toBe("/v2/admin/quality?tab=issues&period=custom&from=2026-10-01&to=2026-10-31&category=linen");
    expect(detectIssueSurges([{ category: "c", label: "C", current: 13, previous: 6 }], span, "x")[0].headline).toMatch(/more than doubled/);
  });

  it("does not fire below the count, below double, or without a previous period", () => {
    expect(detectIssueSurges([{ category: "c", label: "C", current: ISSUE_SURGE_MIN_COUNT - 1, previous: 0 }], span, "x")).toEqual([]);
    expect(detectIssueSurges([{ category: "c", label: "C", current: 11, previous: 6 }], span, "x")).toEqual([]);
    expect(detectIssueSurges([{ category: "c", label: "C", current: 20, previous: 1 }], span, null)).toEqual([]);
  });
});

describe("slow payer detector", () => {
  const terms = 14;
  const days = (value: number, basis = SLOW_PAY_MIN_INVOICES) => buildMeasure(value, basis, {}, 1);

  it("fires at terms + threshold with an overdue balance, linking to the client's overdue invoices", () => {
    const [finding] = detectSlowPayers(
      [{ clientId: "c1", clientName: "Northside Lets", daysToPay: days(terms + SLOW_PAY_MIN_DAYS_OVER_TERMS), overdueAud: 2310 }],
      terms,
    );
    expect(finding.headline).toBe(`Northside Lets pays ${terms + SLOW_PAY_MIN_DAYS_OVER_TERMS} days after invoice on average.`);
    expect(finding.detail).toBe("Terms are 14 days. $2,310 is overdue now.");
    expect(finding.link.href).toBe("/v2/admin/finance?tab=invoices&client=c1&status=overdue");
  });

  it("does not fire one day short, without an overdue balance, or on too few invoices", () => {
    const base = { clientId: "c", clientName: "C", overdueAud: 100 };
    expect(detectSlowPayers([{ ...base, daysToPay: days(terms + SLOW_PAY_MIN_DAYS_OVER_TERMS - 1) }], terms)).toEqual([]);
    expect(detectSlowPayers([{ ...base, overdueAud: 0, daysToPay: days(60) }], terms)).toEqual([]);
    expect(detectSlowPayers([{ ...base, daysToPay: days(60, SLOW_PAY_MIN_INVOICES - 1) }], terms)).toEqual([]);
  });
});

describe("low margin detector", () => {
  it("fires at the floor and not above it, or on too few cleans", () => {
    const at = detectLowMargins([{ propertyId: "p1", propertyName: "Manly Loft", margin: buildMeasure(LOW_MARGIN_MAX_PCT, LOW_MARGIN_MIN_CLEANS, {}, 1) }], span);
    expect(at[0].headline).toBe(`Manly Loft made a ${LOW_MARGIN_MAX_PCT}% margin.`);
    expect(at[0].link.href).toContain("propertyId=p1");
    expect(detectLowMargins([{ propertyId: "p", propertyName: "P", margin: buildMeasure(LOW_MARGIN_MAX_PCT + 0.1, 9, {}, 1) }], span)).toEqual([]);
    expect(detectLowMargins([{ propertyId: "p", propertyName: "P", margin: buildMeasure(1, LOW_MARGIN_MIN_CLEANS - 1, {}, 1) }], span)).toEqual([]);
  });
});

describe("picking findings", () => {
  const finding = (id: string, detector: Finding["detector"], score: number): Finding => ({
    id, detector, score, headline: id, detail: "", basis: "", link: { label: "", href: "/" },
  });

  it("keeps the strongest per detector, then at most three, strongest first", () => {
    const picked = pickFindings([
      finding("a", "property_overrun", 1.2),
      finding("b", "property_overrun", 3),
      finding("c", "issue_surge", 1),
      finding("d", "slow_payer", 2),
      finding("e", "low_margin", 1.5),
    ]);
    expect(picked.map((item) => item.id)).toEqual(["b", "d", "e"]);
  });

  it("returns nothing when nothing fired (the page then says so)", () => {
    expect(pickFindings([])).toEqual([]);
  });
});
