/**
 * Laundry partner portal as drawn (2026-11-12): five phone tabs; every
 * destination the portal had keeps a home (rail and More menu); Today's route
 * list from recorded data; Tracking stages derived from stored status and
 * days only (no "Ready to return"); failed pickups listed as issues.
 */
import { describe, expect, it } from "vitest";
import { mobileTabs } from "@/lib/navigation/mobile-tabs";
import { LAUNDRY_MORE_ITEMS, LAUNDRY_NAV } from "@/components/v2/laundry/portal/laundry-nav";
import { buildTodayStops, officeAskFor, orderUnroutedStops, remainingAddresses, type TodayStopFacts } from "@/lib/laundry/today-stops";
import { failedPickupIssues, stageCounts, trackingDayOf, trackingStage } from "@/lib/laundry/tracking-stages";

/** Every page the portal had before the redesign (app/v2/laundry/**). */
const BEFORE = ["/v2/laundry", "/v2/laundry/queue", "/v2/laundry/runs", "/v2/laundry/tracking", "/v2/laundry/calendar", "/v2/laundry/reports", "/v2/laundry/stats", "/v2/laundry/history", "/v2/laundry/invoices", "/v2/laundry/hub", "/v2/laundry/profile", "/v2/laundry/settings", "/v2/laundry/route"];

describe("navigation parity", () => {
  it("shows the five drawn phone tabs in order", () => {
    expect(mobileTabs("laundry", LAUNDRY_NAV).map((item) => item.label)).toEqual(["Today", "Runs", "Tracking", "History", "More"]);
  });

  it("keeps every earlier destination reachable from the rail, and every non-tab one from More", () => {
    const rail = LAUNDRY_NAV.filter((item) => !item.mobileOnly).map((item) => item.href);
    const tabs = mobileTabs("laundry", LAUNDRY_NAV).map((item) => item.href);
    const more = LAUNDRY_MORE_ITEMS.map((item) => item.href);
    for (const href of BEFORE) {
      expect(rail, href).toContain(href);
      expect([...tabs, ...more], href).toContain(href);
    }
    expect(more).toContain("/v2/laundry/requests");
  });
});

const fact = (patch: Partial<TodayStopFacts>): TodayStopFacts => ({
  taskId: "t1", kind: "PICKUP", propertyName: "Manly Loft", address: "1 The Corso, Manly", plannedTime: "08:30", completedAt: null, status: "CONFIRMED", bagCount: null, readiness: null,
  bagLocation: null, hasDropPhoto: false, receiptAud: null, officeAsked: null, nextGuestDay: null, ...patch,
});
const clock = (iso: string) => iso.slice(11, 16);

describe("Today's route", () => {
  it("marks done, the current stop and the rest, with the drawn facts", () => {
    const stops = buildTodayStops([
      fact({ status: "PICKED_UP", completedAt: "2026-11-12T08:34:00Z", bagCount: 3 }),
      fact({ taskId: "t2", kind: "DROP", status: "DROPPED", completedAt: "2026-11-12T10:15:00Z", officeAsked: "Photo needed" }),
      fact({ taskId: "t3", kind: "DROP", status: "DROPPED", completedAt: "2026-11-12T09:40:00Z", hasDropPhoto: true, bagCount: 3, bagLocation: "lobby cupboard", receiptAud: 48.2 }),
      fact({ taskId: "t4", readiness: true, bagCount: 2, bagLocation: "front door" }),
      fact({ taskId: "t5", readiness: false }),
    ], clock);
    expect(stops.map((stop) => [stop.number, stop.state])).toEqual([[1, "done"], [2, "done"], [3, "done"], [4, "now"], [5, "next"]]);
    expect(stops[0].line).toBe("3 bags · 08:34");
    expect(stops[1]).toMatchObject({ line: "No drop photo · office asked for one", tone: "warn" });
    expect(stops[2].line).toBe("3 bags · 09:40 · lobby cupboard · receipt $48.20 · photo");
    expect(stops[3]).toMatchObject({ line: "Ready · 2 bags · front door", tone: "ok" });
    expect(stops[4].line).toBe("Not ready yet (cleaner said)");
    expect(remainingAddresses(stops)).toEqual(["1 The Corso, Manly", "1 The Corso, Manly"]);
  });

  it("orders a day without a route by planned time, unplanned last", () => {
    const ordered = orderUnroutedStops([fact({ taskId: "a", plannedTime: null, propertyName: "A" }), fact({ taskId: "b", plannedTime: "15:00", kind: "DROP" }), fact({ taskId: "c", plannedTime: "09:00" })]);
    expect(ordered.map((stop) => stop.taskId)).toEqual(["c", "b", "a"]);
  });

  it("shows only an open office request on a stop", () => {
    const request = { taskId: "t2", state: "open", badge: "Photo needed" } as never;
    expect(officeAskFor("t2", [request])).toBe("Photo needed");
    expect(officeAskFor("t2", [{ ...(request as object), state: "answered" } as never])).toBeNull();
    expect(officeAskFor("t2", null)).toBeNull();
  });
});

describe("Tracking stages", () => {
  const TODAY = "2026-11-12";
  it("derives stages from status and days only", () => {
    expect(trackingStage({ status: "CONFIRMED", pickupDate: TODAY, dropoffDate: TODAY }, TODAY)).toBe("pickup");
    expect(trackingStage({ status: "PICKED_UP", pickupDate: "2026-11-10", dropoffDate: "2026-11-13T00:00:00.000Z" }, TODAY)).toBe("laundry");
    expect(trackingStage({ status: "PICKED_UP", pickupDate: "2026-11-10", dropoffDate: "2026-11-12T00:00:00.000Z" }, TODAY)).toBe("drop");
    expect(trackingStage({ status: "DROPPED", pickupDate: TODAY, dropoffDate: TODAY }, TODAY)).toBe("done");
    expect(trackingStage({ status: "SKIPPED_PICKUP", pickupDate: TODAY, dropoffDate: TODAY }, TODAY)).toBeNull();
    expect(stageCounts([{ status: "PENDING", pickupDate: TODAY, dropoffDate: TODAY }, { status: "DROPPED", pickupDate: TODAY, dropoffDate: TODAY }], TODAY)).toEqual({ pickup: 1, laundry: 0, drop: 0, done: 1 });
  });

  it("says Day n of m at the laundry", () => {
    expect(trackingDayOf({ status: "PICKED_UP", pickupDate: "2026-11-10T00:00:00.000Z", dropoffDate: "2026-11-12T00:00:00.000Z", pickedUpAt: null }, TODAY)).toEqual({ day: 3, planned: 2 });
    expect(trackingDayOf({ status: "DROPPED", pickupDate: TODAY, dropoffDate: TODAY }, TODAY)).toBeNull();
  });

  it("lists failed pickups of the last week with the reschedule or the pending decision", () => {
    const issues = failedPickupIssues([{ id: "t1", property: { name: "Bronte Flat" }, confirmations: [
      { notes: JSON.stringify({ event: "FAILED_PICKUP_RESCHEDULE", reason: "Key lost", rescheduledPickupDate: "2026-11-12T00:00:00.000Z" }), createdAt: "2026-11-10T05:00:00Z" },
      { notes: JSON.stringify({ event: "FAILED_PICKUP_REQUEST", reason: "No access", approvalStatus: "PENDING" }), createdAt: "2026-11-11T05:00:00Z" },
      { notes: JSON.stringify({ event: "FAILED_PICKUP_REQUEST", reason: "Old", approvalStatus: "PENDING" }), createdAt: "2026-10-01T05:00:00Z" },
      { notes: JSON.stringify({ event: "PICKED_UP" }), createdAt: "2026-11-11T06:00:00Z" },
    ] }], new Date("2026-11-12T03:00:00Z"));
    expect(issues.map((issue) => [issue.reason, issue.rescheduledTo, issue.awaitingOffice])).toEqual([["No access", null, true], ["Key lost", "2026-11-12", false]]);
  });
});
