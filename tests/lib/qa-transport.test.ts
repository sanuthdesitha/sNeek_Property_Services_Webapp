import { describe, it, expect } from "vitest";
import {
  inspectionDays,
  sydneyDayKey,
  transportAllowanceDescription,
  transportAllowanceLines,
  transportAllowanceTotal,
} from "@/lib/finance/qa-transport";

// Instants chosen to straddle Sydney midnight, which is where a naive UTC date
// gets the day — and therefore the money — wrong.
const TUE_8PM_SYD = new Date("2026-08-24T10:00:00.000Z"); // Tue 24 Aug, 20:00 AEST
const TUE_9PM_SYD = new Date("2026-08-24T11:00:00.000Z"); // Tue 24 Aug, 21:00 AEST
const WED_11AM_SYD = new Date("2026-08-25T01:00:00.000Z"); // Wed 25 Aug, 11:00 AEST

describe("sydneyDayKey", () => {
  it("files a late-evening Sydney inspection under that Sydney day", () => {
    expect(sydneyDayKey(TUE_8PM_SYD)).toBe("2026-08-24");
  });

  it("does not roll a late Tuesday into Wednesday", () => {
    expect(sydneyDayKey(TUE_9PM_SYD)).toBe("2026-08-24");
  });

  it("files an early Wednesday Sydney morning under Wednesday", () => {
    expect(sydneyDayKey(WED_11AM_SYD)).toBe("2026-08-25");
  });
});

describe("inspectionDays", () => {
  it("collapses several inspections on one day into ONE day", () => {
    // The whole point: four properties on a Tuesday is one journey.
    expect(inspectionDays([TUE_8PM_SYD, TUE_9PM_SYD])).toEqual(["2026-08-24"]);
  });

  it("keeps genuinely different days apart", () => {
    expect(inspectionDays([TUE_8PM_SYD, WED_11AM_SYD])).toEqual(["2026-08-24", "2026-08-25"]);
  });

  it("sorts, so travel reads in the order it happened", () => {
    expect(inspectionDays([WED_11AM_SYD, TUE_8PM_SYD])).toEqual(["2026-08-24", "2026-08-25"]);
  });

  it("ignores missing dates rather than inventing a day", () => {
    expect(inspectionDays([null, undefined, TUE_8PM_SYD])).toEqual(["2026-08-24"]);
  });

  it("ignores an invalid Date instead of creating an unmatchable day", () => {
    // "Invalid Date" would become a day key that can never be claimed or
    // released again.
    expect(inspectionDays([new Date("nonsense"), TUE_8PM_SYD])).toEqual(["2026-08-24"]);
  });

  it("returns nothing for no inspections", () => {
    expect(inspectionDays([])).toEqual([]);
  });
});

describe("transportAllowanceLines", () => {
  it("pays one allowance per day worked, not per inspection", () => {
    const lines = transportAllowanceLines({
      inspectionInstants: [TUE_8PM_SYD, TUE_9PM_SYD, WED_11AM_SYD],
      amountPerDay: 25,
    });
    expect(lines).toEqual([
      { day: "2026-08-24", amount: 25 },
      { day: "2026-08-25", amount: 25 },
    ]);
    // Three inspections, two days, $50 — not $75.
    expect(transportAllowanceTotal(lines)).toBe(50);
  });

  it("EXCLUDES a day already claimed on an earlier invoice", () => {
    // The split-day case: the payee sent Tuesday's other inspections last
    // fortnight and is billing the last one now. Tuesday's travel is spent.
    const lines = transportAllowanceLines({
      inspectionInstants: [TUE_8PM_SYD, WED_11AM_SYD],
      amountPerDay: 25,
      alreadyClaimedDays: ["2026-08-24"],
    });
    expect(lines).toEqual([{ day: "2026-08-25", amount: 25 }]);
  });

  it("produces NOTHING when the allowance is not configured", () => {
    // An allowance nobody set must not start appearing as $0.00 lines.
    for (const amountPerDay of [0, -5, Number.NaN]) {
      expect(
        transportAllowanceLines({ inspectionInstants: [TUE_8PM_SYD], amountPerDay }),
        String(amountPerDay)
      ).toEqual([]);
    }
  });

  it("produces nothing when there were no inspections", () => {
    expect(transportAllowanceLines({ inspectionInstants: [], amountPerDay: 25 })).toEqual([]);
  });

  it("rounds to cents so the total cannot drift from the lines", () => {
    const lines = transportAllowanceLines({
      inspectionInstants: [TUE_8PM_SYD, WED_11AM_SYD],
      amountPerDay: 12.335,
    });
    expect(lines.every((l) => l.amount === 12.34)).toBe(true);
    expect(transportAllowanceTotal(lines)).toBe(24.68);
  });
});

describe("transportAllowanceTotal", () => {
  it("is zero for no lines", () => {
    expect(transportAllowanceTotal([])).toBe(0);
  });
});

describe("transportAllowanceDescription", () => {
  it("names the day, so a payee can query one line rather than all of them", () => {
    expect(transportAllowanceDescription("2026-08-24")).toContain("2026-08-24");
  });
});
