import { describe, it, expect } from "vitest";
import {
  compareByTimeThenSuburb,
  computeDropDeadlineFlags,
  isArrivedAtStop,
  nextIncompleteStop,
  normalizeStops,
  parseRouteStops,
  projectArrivalTimes,
  NAIVE_PER_STOP_MIN,
  type DeadlineStop,
} from "@/lib/laundry/route-plan";

const SYD = { lat: -33.8688, lng: 151.2093 };

describe("compareByTimeThenSuburb", () => {
  it("orders by scheduled time first", () => {
    const a = { scheduledAt: "2026-07-25T00:00:00Z", suburb: "Zetland" };
    const b = { scheduledAt: "2026-07-25T01:00:00Z", suburb: "Alexandria" };
    expect(compareByTimeThenSuburb(a, b)).toBeLessThan(0);
    expect(compareByTimeThenSuburb(b, a)).toBeGreaterThan(0);
  });

  it("breaks time ties by suburb, null suburb sorting first", () => {
    const t = "2026-07-25T00:00:00Z";
    const items = [
      { scheduledAt: t, suburb: "Newtown" },
      { scheduledAt: t, suburb: "Bondi" },
      { scheduledAt: t, suburb: null },
    ];
    const sorted = [...items].sort(compareByTimeThenSuburb);
    expect(sorted.map((s) => s.suburb)).toEqual([null, "Bondi", "Newtown"]);
  });
});

describe("normalizeStops / nextIncompleteStop", () => {
  it("re-indexes order 0..n and dedupes taskId+kind", () => {
    const stops = normalizeStops([
      { taskId: "b", kind: "DROP" as const, order: 7 },
      { taskId: "a", kind: "PICKUP" as const, order: 3 },
      { taskId: "a", kind: "PICKUP" as const, order: 9 }, // dupe — dropped
    ]);
    expect(stops.map((s) => [s.taskId, s.order])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("nextIncompleteStop returns the lowest-order stop without completedAt", () => {
    const next = nextIncompleteStop([
      { order: 0, completedAt: "2026-07-25T00:00:00Z" },
      { order: 2, completedAt: null },
      { order: 1, completedAt: null },
    ]);
    expect(next?.order).toBe(1);
    expect(nextIncompleteStop([{ order: 0, completedAt: "x" }])).toBeNull();
  });
});

describe("isArrivedAtStop (120m threshold)", () => {
  it("is true within ~75m and false at ~185m", () => {
    // ~0.00081° lng ≈ 75m at Sydney's latitude; 0.002° ≈ 185m.
    expect(isArrivedAtStop(SYD.lat, SYD.lng + 0.00081, SYD.lat, SYD.lng)).toBe(true);
    expect(isArrivedAtStop(SYD.lat, SYD.lng + 0.002, SYD.lat, SYD.lng)).toBe(false);
  });
});

describe("projectArrivalTimes (naive 35km/h + 7min/stop)", () => {
  it("arrives at the first stop immediately without a start position", () => {
    const start = new Date("2026-07-25T22:00:00Z");
    const [first] = projectArrivalTimes([{ lat: SYD.lat, lng: SYD.lng }], { startAt: start });
    expect(first.getTime()).toBe(start.getTime());
  });

  it("accumulates travel plus service time between stops", () => {
    const start = new Date("2026-07-25T22:00:00Z");
    // 1° of latitude ≈ 111.19km → at 35km/h ≈ 190.6 minutes.
    const arrivals = projectArrivalTimes(
      [
        { lat: SYD.lat, lng: SYD.lng },
        { lat: SYD.lat + 1, lng: SYD.lng },
      ],
      { startAt: start },
    );
    const minutes = (arrivals[1].getTime() - start.getTime()) / 60_000;
    expect(minutes).toBeGreaterThan(NAIVE_PER_STOP_MIN + 185);
    expect(minutes).toBeLessThan(NAIVE_PER_STOP_MIN + 196);
  });
});

describe("computeDropDeadlineFlags", () => {
  const start = new Date("2026-07-25T22:00:00Z"); // 08:00 Sydney (AEST)
  const farNorth = { lat: SYD.lat + 1, lng: SYD.lng }; // ~190min drive away

  function stops(deadlineAt: Date): DeadlineStop[] {
    return [
      { taskId: "p1", kind: "PICKUP", propertyName: "First", ...SYD },
      {
        taskId: "d1",
        kind: "DROP",
        propertyName: "Palm Beach House",
        ...farNorth,
        deadlineAt,
        deadlineLabel: "10:00",
      },
    ];
  }

  it("flags a drop whose projected arrival exceeds the clean start", () => {
    // Deadline 60min out; projected arrival ~197min out → flagged.
    const flags = computeDropDeadlineFlags(stops(new Date(start.getTime() + 60 * 60_000)), {
      startAt: start,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ taskId: "d1", propertyName: "Palm Beach House", deadlineLabel: "10:00" });
    expect(flags[0].projectedArrival.getTime()).toBeGreaterThan(start.getTime());
  });

  it("does not flag when the deadline is comfortably later", () => {
    const flags = computeDropDeadlineFlags(stops(new Date(start.getTime() + 5 * 60 * 60_000)), {
      startAt: start,
    });
    expect(flags).toHaveLength(0);
  });

  it("ignores pickups and drops without a deadline", () => {
    const flags = computeDropDeadlineFlags(
      [
        { taskId: "p1", kind: "PICKUP", propertyName: "A", ...SYD, deadlineAt: new Date(0) },
        { taskId: "d2", kind: "DROP", propertyName: "B", ...SYD, deadlineAt: null },
      ],
      { startAt: start },
    );
    expect(flags).toHaveLength(0);
  });
});

describe("parseRouteStops", () => {
  it("parses valid stops and drops malformed rows", () => {
    const parsed = parseRouteStops([
      { taskId: "t1", kind: "PICKUP", order: 1, propertyId: "p1" },
      { taskId: "t2", kind: "DROP", order: 0, propertyId: "p2", completedAt: "2026-07-25T00:00:00Z" },
      { taskId: "bad", kind: "NOPE", order: 2, propertyId: "p3" },
      "garbage",
      null,
    ]);
    expect(parsed.map((s) => s.taskId)).toEqual(["t2", "t1"]);
    expect(parsed[0].completedAt).toBe("2026-07-25T00:00:00Z");
    expect(parsed.map((s) => s.order)).toEqual([0, 1]);
  });

  it("returns [] for non-array input", () => {
    expect(parseRouteStops(null)).toEqual([]);
    expect(parseRouteStops({})).toEqual([]);
  });
});
