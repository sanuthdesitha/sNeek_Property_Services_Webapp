import { describe, it, expect } from "vitest";
import {
  parseVisitPlan,
  visitIsOnDay,
  describeVisitForCleaner,
} from "@/lib/maintenance/visit-plan";

// 23:00Z is 09:00 the NEXT day in Sydney. Several cases turn on that, so it is
// in the fixture rather than hidden inside an assertion.
const START = "2026-08-25T23:00:00.000Z";

const raw = (over: Record<string, unknown> = {}) => ({
  startAt: START,
  accessMethod: "LOCKBOX",
  cleanerPresence: "WORK_AROUND",
  cleanTiming: "AFTER",
  areasAffected: ["Ensuite"],
  remindOnDay: true,
  ...over,
});

describe("parseVisitPlan", () => {
  it("reads a complete plan back", () => {
    const plan = parseVisitPlan(raw());
    expect(plan).not.toBeNull();
    expect(plan!.startAt).toBe(START);
    expect(plan!.accessMethod).toBe("LOCKBOX");
    expect(plan!.cleanTiming).toBe("AFTER");
    expect(plan!.areasAffected).toEqual(["Ensuite"]);
    expect(plan!.remindOnDay).toBe(true);
  });

  it("is not a visit without a start time", () => {
    // Showing half a visit is worse than showing none — the cleaner would plan
    // around a fact that is not there.
    expect(parseVisitPlan(raw({ startAt: undefined }))).toBeNull();
    expect(parseVisitPlan(raw({ startAt: "not-a-date" }))).toBeNull();
    expect(parseVisitPlan(null)).toBeNull();
    expect(parseVisitPlan([])).toBeNull();
    expect(parseVisitPlan("plumber tuesday")).toBeNull();
  });

  it("assumes the cleaner must open the door when access is unrecognised", () => {
    // The safe default: be asked, rather than be surprised at the door.
    expect(parseVisitPlan(raw({ accessMethod: "TELEPORT" }))!.accessMethod).toBe("CLEANER_LETS_IN");
    expect(parseVisitPlan(raw({ accessMethod: undefined }))!.accessMethod).toBe("CLEANER_LETS_IN");
  });

  it("falls back to sane values for the other choices", () => {
    const plan = parseVisitPlan(raw({ cleanerPresence: "MAYBE", cleanTiming: "SOMETIME" }))!;
    expect(plan.cleanerPresence).toBe("WORK_AROUND");
    expect(plan.cleanTiming).toBe("UNAFFECTED");
  });

  it("drops an end time that precedes the start", () => {
    // A data-entry slip, not a window. Keeping it would render an impossible
    // range; dropping it leaves a valid single-point visit.
    expect(parseVisitPlan(raw({ endAt: "2026-08-25T20:00:00.000Z" }))!.endAt).toBeUndefined();
  });

  it("keeps a real end time", () => {
    expect(parseVisitPlan(raw({ endAt: "2026-08-26T01:00:00.000Z" }))!.endAt).toBe(
      "2026-08-26T01:00:00.000Z"
    );
  });

  it("caps a mistyped duration instead of trusting it", () => {
    // 30 days is a typo, not a plumber.
    expect(parseVisitPlan(raw({ expectedMinutes: 43_200 }))!.expectedMinutes).toBe(24 * 60);
    expect(parseVisitPlan(raw({ expectedMinutes: -5 }))!.expectedMinutes).toBeUndefined();
    expect(parseVisitPlan(raw({ expectedMinutes: "soon" }))!.expectedMinutes).toBeUndefined();
  });

  it("ignores rubbish in the areas list", () => {
    const plan = parseVisitPlan(raw({ areasAffected: ["Kitchen", "", null, 7, "  "] }))!;
    expect(plan.areasAffected).toEqual(["Kitchen"]);
  });

  it("treats a missing areas list as none rather than failing", () => {
    expect(parseVisitPlan(raw({ areasAffected: undefined }))!.areasAffected).toEqual([]);
  });

  it("never invents a reminder", () => {
    expect(parseVisitPlan(raw({ remindOnDay: undefined }))!.remindOnDay).toBe(false);
    expect(parseVisitPlan(raw({ remindOnDay: "yes" }))!.remindOnDay).toBe(false);
  });

  it("carries no cost field at all", () => {
    // A VA must never commit spend, so there is nowhere for a cost to live.
    const plan = parseVisitPlan(raw({ estimatedCost: 500, quotedCost: 700 }))!;
    expect(plan).not.toHaveProperty("estimatedCost");
    expect(plan).not.toHaveProperty("quotedCost");
  });
});

describe("visitIsOnDay", () => {
  it("matches the Sydney day, not the UTC one", () => {
    const plan = parseVisitPlan(raw())!;
    // The visit is 23:00Z on the 25th — the 26th in Sydney.
    expect(visitIsOnDay(plan, new Date("2026-08-26T02:00:00.000Z"))).toBe(true);
    expect(visitIsOnDay(plan, new Date("2026-08-25T12:00:00.000Z"))).toBe(false);
  });
});

describe("describeVisitForCleaner", () => {
  it("leads with when, then whether they open the door", () => {
    const plan = parseVisitPlan(raw({ accessMethod: "CLEANER_LETS_IN" }))!;
    const { lines } = describeVisitForCleaner(plan, "Leaking tap");
    expect(lines[0]).toMatch(/Expected around/);
    expect(lines.some((l) => /let them in/i.test(l))).toBe(true);
  });

  it("names the job in the title so it is not just 'maintenance'", () => {
    const plan = parseVisitPlan(raw())!;
    expect(describeVisitForCleaner(plan, "Leaking tap").title).toContain("Leaking tap");
  });

  it("says the clean waits when the work comes first", () => {
    const plan = parseVisitPlan(raw({ cleanTiming: "AFTER" }))!;
    const { lines } = describeVisitForCleaner(plan, "Repaint");
    expect(lines.some((l) => /Clean AFTER/.test(l))).toBe(true);
  });

  it("shows a window when there is one", () => {
    const plan = parseVisitPlan(raw({ endAt: "2026-08-26T01:00:00.000Z" }))!;
    expect(describeVisitForCleaner(plan, "x").lines[0]).toMatch(/between .* and /);
  });

  it("omits everything that was not filled in", () => {
    // A briefing padded with "not specified" is one people stop reading.
    const { lines } = describeVisitForCleaner(parseVisitPlan(raw())!, "x");
    expect(lines.some((l) => /Contractor:/.test(l))).toBe(false);
    expect(lines.some((l) => /goes wrong/.test(l))).toBe(false);
    expect(lines.every((l) => l.trim().length > 0)).toBe(true);
  });

  it("gives the contractor and the escalation contact when known", () => {
    const plan = parseVisitPlan(
      raw({
        contractorName: "Sam's Plumbing",
        contractorPhone: "0400 000 000",
        dayContactName: "Priya",
        dayContactPhone: "0411 111 111",
      })
    )!;
    const { lines } = describeVisitForCleaner(plan, "x");
    expect(lines.some((l) => l.includes("Sam's Plumbing") && l.includes("0400 000 000"))).toBe(true);
    expect(lines.some((l) => /goes wrong.*Priya/.test(l))).toBe(true);
  });

  it("reads a duration in hours once it passes an hour", () => {
    const plan = parseVisitPlan(raw({ expectedMinutes: 150 }))!;
    const { lines } = describeVisitForCleaner(plan, "x");
    expect(lines.some((l) => /2 hours 30 min/.test(l))).toBe(true);
  });
});
