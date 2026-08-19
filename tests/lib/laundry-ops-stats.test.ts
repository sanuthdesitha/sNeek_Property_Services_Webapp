import { describe, it, expect } from "vitest";
import {
  buildLaundryOpsStats,
  daysBetweenKeys,
  laundryWindowStartKey,
  type LaundryStatsTask,
} from "@/lib/laundry/ops-stats";

/**
 * Every case here is a Sydney-calendar boundary. The point is not that the
 * numbers add up — it is that they add up the way an operator in Sydney counts
 * them, not the way a UTC server would.
 *
 * Sydney is UTC+10 (AEST) June–September, UTC+11 (AEDT) November–March.
 */

const OPTIONS = { todayKey: "2026-08-20", maxOutdoorDays: 3, trendWeeks: 8, leaderboardSize: 10 };

function task(overrides: Partial<LaundryStatsTask> & { id: string }): LaundryStatsTask {
  return {
    status: "DROPPED",
    pickupDate: new Date("2026-08-17T00:00:00.000Z"),
    dropoffDate: new Date("2026-08-19T00:00:00.000Z"),
    pickedUpAt: new Date("2026-08-17T01:00:00.000Z"),
    droppedAt: new Date("2026-08-19T01:00:00.000Z"),
    flagReason: null,
    dropoffCostAud: null,
    property: { id: "prop-1", name: "Bondi Loft", suburb: "Bondi" },
    ...overrides,
  };
}

describe("daysBetweenKeys", () => {
  it("counts whole calendar days across a month boundary", () => {
    expect(daysBetweenKeys("2026-07-30", "2026-08-02")).toBe(3);
  });

  it("counts across a daylight-saving change without losing or gaining a day", () => {
    expect(daysBetweenKeys("2026-04-02", "2026-04-09")).toBe(7);
  });
});

describe("laundryWindowStartKey", () => {
  it("starts on the Monday N-1 weeks before the week containing today", () => {
    // 20 Aug 2026 is a Thursday; its Monday is the 17th, minus 7 weeks = 29 Jun.
    expect(laundryWindowStartKey("2026-08-20", 8)).toBe("2026-06-29");
  });

  it("treats Sunday as the end of its week, not the start of the next", () => {
    // 23 Aug 2026 is a Sunday and still belongs to the week of Monday the 17th.
    expect(laundryWindowStartKey("2026-08-23", 8)).toBe(laundryWindowStartKey("2026-08-20", 8));
  });
});

describe("buildLaundryOpsStats — on-time", () => {
  it("counts a drop-off late on the due evening in Sydney as on time", () => {
    // Due 19 Aug. Dropped 19 Aug 22:00 Sydney = 12:00 UTC the same day.
    const stats = buildLaundryOpsStats(
      [task({ id: "t1", droppedAt: new Date("2026-08-19T12:00:00.000Z") })],
      OPTIONS
    );
    expect(stats.droppedCount).toBe(1);
    expect(stats.onTimeCount).toBe(1);
  });

  it("counts a drop-off the NEXT Sydney morning as late", () => {
    // 20 Aug 08:00 Sydney = 19 Aug 22:00 UTC. A UTC endOfDay check would call
    // this on time — it is a day late to everyone who works here.
    const stats = buildLaundryOpsStats(
      [task({ id: "t1", droppedAt: new Date("2026-08-19T22:00:00.000Z") })],
      OPTIONS
    );
    expect(stats.onTimeCount).toBe(0);
  });

  it("ignores tasks that never came back", () => {
    const stats = buildLaundryOpsStats(
      [task({ id: "t1", status: "PICKED_UP", droppedAt: null })],
      OPTIONS
    );
    expect(stats.droppedCount).toBe(0);
    expect(stats.onTimeCount).toBe(0);
  });
});

describe("buildLaundryOpsStats — weekly buckets", () => {
  it("buckets a Monday-morning Sydney drop into that Monday's week", () => {
    // 17 Aug 09:00 Sydney = 16 Aug 23:00 UTC, which is a Sunday in UTC.
    const stats = buildLaundryOpsStats(
      [task({ id: "t1", droppedAt: new Date("2026-08-16T23:00:00.000Z") })],
      OPTIONS
    );
    expect(stats.weeks.find((w) => w.key === "2026-08-17")?.dropped).toBe(1);
    expect(stats.weeks.find((w) => w.key === "2026-08-10")?.dropped).toBe(0);
  });

  it("returns exactly trendWeeks buckets, oldest first", () => {
    const stats = buildLaundryOpsStats([], OPTIONS);
    expect(stats.weeks).toHaveLength(8);
    expect(stats.weeks[0].key).toBe("2026-06-29");
    expect(stats.weeks[7].key).toBe("2026-08-17");
  });

  it("attributes a skip to the week the pickup was scheduled for", () => {
    const stats = buildLaundryOpsStats(
      [
        task({
          id: "t1",
          status: "SKIPPED_PICKUP",
          pickupDate: new Date("2026-08-14T00:00:00.000Z"), // Friday, week of 10 Aug
          droppedAt: null,
          pickedUpAt: null,
        }),
      ],
      OPTIONS
    );
    expect(stats.weeks.find((w) => w.key === "2026-08-10")?.skipped).toBe(1);
    expect(stats.weeks.find((w) => w.key === "2026-08-17")?.skipped).toBe(0);
  });

  it("treats a flagReason as flagged even when the status has moved on", () => {
    const stats = buildLaundryOpsStats([task({ id: "t1", flagReason: "NO_WINDOW" })], OPTIONS);
    expect(stats.weeks.find((w) => w.key === "2026-08-17")?.flagged).toBe(1);
  });

  it("sums drop-off cost into the week the bag came back", () => {
    const stats = buildLaundryOpsStats([task({ id: "t1", dropoffCostAud: 42.5 })], OPTIONS);
    expect(stats.weeks.find((w) => w.key === "2026-08-17")?.costAud).toBe(42.5);
  });
});

describe("buildLaundryOpsStats — outstanding and overdue", () => {
  const out = (id: string, pickedUpAt: string) =>
    task({ id, status: "PICKED_UP", pickedUpAt: new Date(pickedUpAt), droppedAt: null });

  it("flags only bags out longer than maxOutdoorDays", () => {
    const stats = buildLaundryOpsStats(
      [
        out("fresh", "2026-08-18T00:00:00.000Z"), // 2 days
        out("edge", "2026-08-17T00:00:00.000Z"), // exactly 3 — not overdue
        out("stale", "2026-08-10T00:00:00.000Z"), // 10 days
      ],
      OPTIONS
    );
    expect(stats.outstandingCount).toBe(3);
    expect(stats.overdue.map((o) => o.task.id)).toEqual(["stale"]);
    expect(stats.overdue[0].daysOut).toBe(10);
  });

  it("sorts the worst offender first", () => {
    const stats = buildLaundryOpsStats(
      [out("a", "2026-08-15T00:00:00.000Z"), out("b", "2026-08-01T00:00:00.000Z")],
      OPTIONS
    );
    expect(stats.overdue.map((o) => o.task.id)).toEqual(["b", "a"]);
  });

  it("keeps a months-old bag visible even though it predates the trend window", () => {
    const stats = buildLaundryOpsStats([out("ancient", "2026-01-05T00:00:00.000Z")], OPTIONS);
    expect(stats.outstandingCount).toBe(1);
    expect(stats.overdue).toHaveLength(1);
  });
});

describe("buildLaundryOpsStats — turnaround", () => {
  it("averages pickup→drop hours", () => {
    const stats = buildLaundryOpsStats(
      [
        task({
          id: "t1",
          pickedUpAt: new Date("2026-08-17T00:00:00.000Z"),
          droppedAt: new Date("2026-08-17T10:00:00.000Z"),
        }),
        task({
          id: "t2",
          pickedUpAt: new Date("2026-08-17T00:00:00.000Z"),
          droppedAt: new Date("2026-08-17T20:00:00.000Z"),
        }),
      ],
      OPTIONS
    );
    expect(stats.avgTurnaroundHours).toBe(15);
  });

  it("drops negative spans rather than letting a bad row flatter the average", () => {
    const stats = buildLaundryOpsStats(
      [
        task({
          id: "good",
          pickedUpAt: new Date("2026-08-17T00:00:00.000Z"),
          droppedAt: new Date("2026-08-17T10:00:00.000Z"),
        }),
        task({
          id: "backwards",
          pickedUpAt: new Date("2026-08-17T10:00:00.000Z"),
          droppedAt: new Date("2026-08-17T00:00:00.000Z"),
        }),
      ],
      OPTIONS
    );
    expect(stats.avgTurnaroundHours).toBe(10);
  });

  it("is null when nothing has completed a cycle", () => {
    const stats = buildLaundryOpsStats([], OPTIONS);
    expect(stats.avgTurnaroundHours).toBeNull();
  });
});

describe("buildLaundryOpsStats — month and leaderboard", () => {
  it("counts the Sydney month, not the UTC one", () => {
    // 1 Aug 09:00 Sydney = 31 Jul 23:00 UTC. Sydney says August.
    const stats = buildLaundryOpsStats(
      [task({ id: "t1", droppedAt: new Date("2026-07-31T23:00:00.000Z"), dropoffCostAud: 10 })],
      OPTIONS
    );
    expect(stats.monthDroppedCount).toBe(1);
    expect(stats.monthCostAud).toBe(10);
  });

  it("ranks properties by total volume and reports how many came back", () => {
    const busy = { id: "p2", name: "Manly Flat", suburb: null };
    const stats = buildLaundryOpsStats(
      [
        task({ id: "a", property: busy }),
        task({ id: "b", property: busy, status: "PICKED_UP", droppedAt: null }),
        task({ id: "c" }),
      ],
      OPTIONS
    );
    expect(stats.leaderboard[0]).toMatchObject({ propertyId: "p2", count: 2, dropped: 1 });
    expect(stats.leaderboard[0].label).toBe("Manly Flat");
    expect(stats.leaderboard[1]).toMatchObject({ propertyId: "prop-1", count: 1, dropped: 1 });
    expect(stats.leaderboard[1].label).toBe("Bondi Loft · Bondi");
  });

  it("honours leaderboardSize", () => {
    const tasks = Array.from({ length: 5 }, (_, i) =>
      task({ id: `t${i}`, property: { id: `p${i}`, name: `Property ${i}`, suburb: null } })
    );
    const stats = buildLaundryOpsStats(tasks, { ...OPTIONS, leaderboardSize: 2 });
    expect(stats.leaderboard).toHaveLength(2);
  });

  it("skips tasks with no property rather than throwing", () => {
    const stats = buildLaundryOpsStats([task({ id: "orphan", property: null })], OPTIONS);
    expect(stats.leaderboard).toHaveLength(0);
    expect(stats.droppedCount).toBe(1);
  });
});
