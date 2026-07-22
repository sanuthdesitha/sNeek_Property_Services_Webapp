import { describe, it, expect } from "vitest";
import { BRIEF_RULES, buildQaBrief, briefSeverity, type QaBriefContext } from "@/lib/qa/brief-rules";

const NOW = new Date("2026-07-23T02:00:00.000Z");

function ctx(overrides: Partial<QaBriefContext> = {}): QaBriefContext {
  return {
    now: NOW,
    job: {
      id: "job-1",
      jobType: "AIRBNB_TURNOVER",
      status: "SUBMITTED",
      formPendingAfterClockOut: false,
      expectedHours: 3,
      actualHours: 3,
      isRework: false,
    },
    property: { id: "prop-1", name: "Bondi 12", sofaBedCount: 0, hasBalcony: false },
    cleaners: [{ id: "c1", name: "Ana" }],
    submission: { submittedAt: NOW.toISOString(), photoCount: 12 },
    lowStock: [],
    laundry: null,
    reservation: null,
    propertyWatchOuts: [],
    cleanerWatchOuts: [],
    cleanerRecentSevereIssues: { major: 0, critical: 0, windowDays: 30 },
    cleanerPriorJobsAtProperty: 4,
    propertyReworkCount: 0,
    ...overrides,
  };
}

function ids(items: { id: string }[]) {
  return items.map((i) => i.id);
}

describe("buildQaBrief", () => {
  it("a clean, ordinary job produces no brief items", () => {
    expect(buildQaBrief(ctx())).toEqual([]);
  });

  it("flags a clean finished well under the allocated time", () => {
    const items = buildQaBrief(ctx({ job: { ...ctx().job, actualHours: 1.2 } }));
    expect(ids(items)).toContain("time-under");
    expect(items.find((i) => i.id === "time-under")?.tone).toBe("danger");
  });

  it("a mildly short clean is a warning, not a danger", () => {
    const items = buildQaBrief(ctx({ job: { ...ctx().job, actualHours: 1.9 } }));
    expect(items.find((i) => i.id === "time-under")?.tone).toBe("warning");
  });

  it("flags an over-time clean as info", () => {
    const items = buildQaBrief(ctx({ job: { ...ctx().job, actualHours: 5 } }));
    expect(items.find((i) => i.id === "time-over")?.tone).toBe("info");
  });

  it("flags a checklist still pending after clock-out", () => {
    const items = buildQaBrief(ctx({ job: { ...ctx().job, formPendingAfterClockOut: true } }));
    expect(ids(items)).toContain("form-pending");
  });

  it("flags a missing submission", () => {
    expect(ids(buildQaBrief(ctx({ submission: null })))).toContain("no-submission");
  });

  it("lists low stock with counts", () => {
    const items = buildQaBrief(
      ctx({ lowStock: [{ name: "Toilet paper", onHand: 1, threshold: 4 }] })
    );
    const item = items.find((i) => i.id === "low-stock");
    expect(item?.title).toContain("1 item");
    expect(item?.detail).toContain("Toilet paper (1)");
  });

  it("reuses the property watch-outs as repeat issues", () => {
    const items = buildQaBrief(
      ctx({ propertyWatchOuts: [{ label: "Shower screen", count: 3, category: "bathroom" }] })
    );
    expect(items.find((i) => i.id === "repeat-property-issues")?.detail).toContain("shower screen ×3");
  });

  it("escalates the cleaner's recent critical verdicts to danger", () => {
    const items = buildQaBrief(
      ctx({ cleanerRecentSevereIssues: { major: 1, critical: 2, windowDays: 30 } })
    );
    const item = items.find((i) => i.id === "cleaner-severe-history");
    expect(item?.tone).toBe("danger");
    expect(item?.title).toContain("Ana");
  });

  it("major-only history is a warning", () => {
    const items = buildQaBrief(
      ctx({ cleanerRecentSevereIssues: { major: 2, critical: 0, windowDays: 30 } })
    );
    expect(items.find((i) => i.id === "cleaner-severe-history")?.tone).toBe("warning");
  });

  it("flags a first-time visit to the property", () => {
    const items = buildQaBrief(ctx({ cleanerPriorJobsAtProperty: 0 }));
    expect(items.find((i) => i.id === "first-time-at-property")?.title).toContain("Ana");
  });

  it("flags sofa beds and balconies together", () => {
    const items = buildQaBrief(
      ctx({ property: { id: "p", name: "X", sofaBedCount: 2, hasBalcony: true } })
    );
    expect(items.find((i) => i.id === "sofa-bed-balcony")?.title).toContain("2 sofa beds + balcony");
  });

  it("counts down to the guest check-in and escalates when it is close", () => {
    const soon = new Date(NOW.getTime() + 90 * 60_000).toISOString();
    const items = buildQaBrief(ctx({ reservation: { guestCheckInAt: soon } }));
    const item = items.find((i) => i.id === "guest-arrival");
    expect(item?.tone).toBe("danger");
    expect(item?.title).toContain("1h 30m");
  });

  it("a distant guest arrival is only info", () => {
    const later = new Date(NOW.getTime() + 8 * 60 * 60_000).toISOString();
    const items = buildQaBrief(ctx({ reservation: { guestCheckInAt: later } }));
    expect(items.find((i) => i.id === "guest-arrival")?.tone).toBe("info");
  });

  it("flags guests already past check-in", () => {
    const past = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const items = buildQaBrief(ctx({ reservation: { guestCheckInAt: past } }));
    expect(items.find((i) => i.id === "guest-arrival")?.title).toContain("were due");
  });

  it("flags unconfirmed laundry", () => {
    const items = buildQaBrief(ctx({ laundry: { required: true, confirmed: false } }));
    expect(ids(items)).toContain("laundry-outstanding");
    expect(ids(buildQaBrief(ctx({ laundry: { required: true, confirmed: true } })))).not.toContain(
      "laundry-outstanding"
    );
  });

  it("flags a property with repeated reworks", () => {
    expect(ids(buildQaBrief(ctx({ propertyReworkCount: 3 })))).toContain("property-rework-history");
    expect(ids(buildQaBrief(ctx({ propertyReworkCount: 1 })))).not.toContain("property-rework-history");
  });

  it("preserves the declared rule order (guest arrival before low stock)", () => {
    const items = buildQaBrief(
      ctx({
        reservation: { guestCheckInAt: new Date(NOW.getTime() + 60 * 60_000).toISOString() },
        lowStock: [{ name: "Bin liners", onHand: 0, threshold: 2 }],
      })
    );
    expect(ids(items).indexOf("guest-arrival")).toBeLessThan(ids(items).indexOf("low-stock"));
  });

  it("a throwing rule is skipped, never fatal", () => {
    const boom = () => {
      throw new Error("bad rule");
    };
    const ok = () => ({ id: "ok", tone: "info" as const, title: "T", detail: "D" });
    expect(buildQaBrief(ctx(), [boom, ok])).toEqual([{ id: "ok", tone: "info", title: "T", detail: "D" }]);
  });

  it("every rule returns null for an unremarkable context", () => {
    for (const rule of BRIEF_RULES) expect(rule(ctx())).toBeNull();
  });
});

describe("briefSeverity", () => {
  it("reports the highest tone present", () => {
    expect(briefSeverity([])).toBe("info");
    expect(briefSeverity([{ id: "a", tone: "warning", title: "", detail: "" }])).toBe("warning");
    expect(
      briefSeverity([
        { id: "a", tone: "warning", title: "", detail: "" },
        { id: "b", tone: "danger", title: "", detail: "" },
      ])
    ).toBe("danger");
  });
});
