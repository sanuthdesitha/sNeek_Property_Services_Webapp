// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  LIVE_LAUNDRY_TABS,
  classifyLane,
  detectExceptions,
  resolveLaundryTab,
  type PipelineTaskInput,
} from "@/lib/laundry/pipeline";
import { planReschedule } from "@/lib/laundry/reschedule-dates";
import { laundryStatsRedirectTarget } from "@/lib/laundry/stats-redirect";
import { sydneyDayStart } from "@/lib/time/sydney-range";

const TODAY = "2026-11-11";
/** The planner's convention: the calendar day at UTC midnight. */
const utc = (key: string) => `${key}T00:00:00.000Z`;
/** The other convention seen in the data: the Sydney midnight instant. */
const syd = (key: string) => sydneyDayStart(key).toISOString();

const task = (patch: Partial<PipelineTaskInput>): PipelineTaskInput => ({
  status: "PENDING",
  pickupDate: utc(TODAY),
  dropoffDate: utc("2026-11-13"),
  confirmations: [],
  ...patch,
});

describe("lane classification", () => {
  it.each(["PENDING", "CONFIRMED", "FLAGGED"])("%s with pickup on the day is To pick up", (status) => {
    expect(classifyLane(task({ status }), TODAY, TODAY)).toEqual({ lane: "pickup", carriedIn: false });
  });

  it("an earlier pickup still not done is carried into today's view only", () => {
    const overdue = task({ pickupDate: utc("2026-11-08") });
    expect(classifyLane(overdue, TODAY, TODAY)).toEqual({ lane: "pickup", carriedIn: true });
    expect(classifyLane(overdue, "2026-11-12", TODAY)).toBeNull();
    expect(classifyLane(overdue, "2026-11-10", TODAY)).toBeNull();
  });

  it("a future pickup appears only on its own day", () => {
    const future = task({ pickupDate: utc("2026-11-12") });
    expect(classifyLane(future, TODAY, TODAY)).toBeNull();
    expect(classifyLane(future, "2026-11-12", TODAY)).toEqual({ lane: "pickup", carriedIn: false });
  });

  it("PICKED_UP: at the laundry until the drop-off day, then To drop; overdue drops carried into today", () => {
    const out = task({ status: "PICKED_UP", pickupDate: utc("2026-11-10"), pickedUpAt: "2026-11-10T02:00:00Z", dropoffDate: utc("2026-11-12") });
    expect(classifyLane(out, TODAY, TODAY)).toEqual({ lane: "laundry", carriedIn: false });
    expect(classifyLane(out, "2026-11-12", TODAY)).toEqual({ lane: "drop", carriedIn: false });
    expect(classifyLane(out, "2026-11-09", TODAY)).toBeNull();
    const late = { ...out, dropoffDate: utc("2026-11-09") };
    expect(classifyLane(late, TODAY, TODAY)).toEqual({ lane: "drop", carriedIn: true });
    expect(classifyLane(late, "2026-11-12", TODAY)).toBeNull();
  });

  it("DROPPED is Delivered on its delivery day (planned day when no time was recorded)", () => {
    expect(classifyLane(task({ status: "DROPPED", droppedAt: "2026-11-10T23:30:00Z" }), TODAY, TODAY)).toEqual({ lane: "delivered", carriedIn: false });
    expect(classifyLane(task({ status: "DROPPED", droppedAt: "2026-11-10T10:00:00Z" }), TODAY, TODAY)).toBeNull();
    expect(classifyLane(task({ status: "DROPPED", droppedAt: null, dropoffDate: utc(TODAY) }), TODAY, TODAY)?.lane).toBe("delivered");
  });

  it("SKIPPED_PICKUP is in no lane", () => {
    expect(classifyLane(task({ status: "SKIPPED_PICKUP" }), TODAY, TODAY)).toBeNull();
  });

  it.each([
    ["DST start", "2026-10-04"],
    ["DST end", "2026-04-05"],
  ])("reads both date conventions as the same Sydney day across %s", (_label, day) => {
    expect(classifyLane(task({ pickupDate: utc(day) }), day, day)?.lane).toBe("pickup");
    expect(classifyLane(task({ pickupDate: syd(day) }), day, day)?.lane).toBe("pickup");
    expect(classifyLane(task({ pickupDate: syd(day) }), day.replace(/\d\d$/, (d) => String(Number(d) - 1).padStart(2, "0")), day)).toBeNull();
  });
});

describe("exceptions", () => {
  const settings = { maxOutdoorDays: 3, requireDropoffPhoto: true };
  const now = new Date("2026-11-11T05:00:00Z");
  const codes = (input: PipelineTaskInput, override = settings) => detectExceptions(input, { todayKey: TODAY, now, settings: override }).map((e) => e.code);

  it("flagged, failed pickup awaiting a decision, not ready and overdue pickup", () => {
    expect(codes(task({ status: "FLAGGED", flagReason: "NOT_READY" }))).toContain("FLAGGED");
    expect(codes(task({ confirmations: [{ laundryReady: true, notes: JSON.stringify({ event: "FAILED_PICKUP_REQUEST", approvalStatus: "PENDING" }), createdAt: now }] }))).toContain("FAILED_PICKUP");
    expect(codes(task({ confirmations: [{ laundryReady: false, notes: JSON.stringify({ source: "FORM" }), createdAt: now }] }))).toContain("NOT_READY");
    expect(codes(task({ pickupDate: utc("2026-11-09") }))).toContain("PICKUP_OVERDUE");
    expect(codes(task({}))).toEqual([]);
  });

  it("over turnaround uses the supplier's hours when set, else the max outdoor days setting", () => {
    const out = task({ status: "PICKED_UP", pickedUpAt: "2026-11-10T00:00:00Z", dropoffDate: utc("2026-11-13") });
    expect(codes({ ...out, supplier: { avgTurnaround: 24 } })).toContain("OVER_TURNAROUND");
    expect(codes({ ...out, supplier: { avgTurnaround: 48 } })).not.toContain("OVER_TURNAROUND");
    expect(codes({ ...out, supplier: null })).not.toContain("OVER_TURNAROUND");
    expect(codes({ ...out, supplier: null, pickedUpAt: "2026-11-07T00:00:00Z" })).toContain("OVER_TURNAROUND");
    expect(codes({ ...out, dropoffDate: utc("2026-11-10") })).toContain("DROP_OVERDUE");
  });

  it("missing drop photo only when the setting requires one", () => {
    const delivered = task({ status: "DROPPED", droppedAt: now.toISOString(), confirmations: [{ laundryReady: true, notes: JSON.stringify({ event: "DROPPED" }), createdAt: now }] });
    expect(codes(delivered)).toEqual(["NO_DROP_PHOTO"]);
    expect(codes(delivered, { ...settings, requireDropoffPhoto: false })).toEqual([]);
    const withPhoto = { ...delivered, confirmations: [{ laundryReady: true, photoUrl: "https://x/p.jpg", notes: JSON.stringify({ event: "DROPPED" }), createdAt: now }] };
    expect(codes(withPhoto)).toEqual([]);
  });
});

describe("tabs and links", () => {
  it("maps every old tab id", () => {
    expect(resolveLaundryTab("today")).toEqual({ tab: "pipeline", view: "board" });
    expect(resolveLaundryTab("completed")).toEqual({ tab: "pipeline", view: "completed" });
    expect(resolveLaundryTab("investigate")?.tab).toBe("property");
    expect(resolveLaundryTab("live")?.tab).toBe("live");
    expect(resolveLaundryTab("reports")?.tab).toBe("costs");
    expect(resolveLaundryTab("suppliers")?.tab).toBe("suppliers");
    expect(resolveLaundryTab("stats")?.tab).toBe("statistics");
    expect(resolveLaundryTab("nope")).toBeNull();
  });
  it("polls only on Pipeline and Drivers live", () => {
    expect(Array.from(LIVE_LAUNDRY_TABS).sort()).toEqual(["live", "pipeline"]);
  });
  it("the old statistics address redirects to the tab and keeps its parameters", () => {
    expect(laundryStatsRedirectTarget({ period: "month", tab: "x" })).toBe("/v2/admin/laundry?period=month&tab=statistics");
    expect(laundryStatsRedirectTarget()).toBe("/v2/admin/laundry?tab=statistics");
  });
});

describe("reschedule plan", () => {
  it("moves pickup and keeps the gap before pickup; only the drop-off once picked up", () => {
    expect(planReschedule({ status: "CONFIRMED", pickupDate: utc(TODAY), dropoffDate: utc("2026-11-13") }, "2026-11-12")).toEqual({ ok: true, pickupKey: "2026-11-12", dropoffKey: "2026-11-14", movesPickup: true });
    expect(planReschedule({ status: "PICKED_UP", pickupDate: utc("2026-11-10"), dropoffDate: utc("2026-11-12"), pickedUpAt: "2026-11-10T01:00:00Z" }, "2026-11-13")).toEqual({ ok: true, pickupKey: "2026-11-10", dropoffKey: "2026-11-13", movesPickup: false });
    expect(planReschedule({ status: "PICKED_UP", pickupDate: utc("2026-11-10"), dropoffDate: utc("2026-11-12") }, "2026-11-09").ok).toBe(false);
    expect(planReschedule({ status: "DROPPED", pickupDate: utc(TODAY), dropoffDate: utc(TODAY) }, "2026-11-12").ok).toBe(false);
    expect(planReschedule({ status: "PENDING", pickupDate: utc(TODAY), dropoffDate: utc(TODAY) }, "bad").ok).toBe(false);
  });
});
