import { describe, it, expect } from "vitest";
import {
  computeLaundryTeamStats,
  type LaundryConfirmationLite,
  type LaundryTaskLite,
} from "@/lib/accountability/laundry-stats";

const NOW = new Date("2026-07-25T00:00:00.000Z"); // 10:00 Sat 25 Jul in Sydney (AEST)
const RANGE_START = new Date("2026-06-25T00:00:00.000Z");

function task(overrides: Partial<LaundryTaskLite> & { id: string }): LaundryTaskLite {
  return {
    status: "DROPPED",
    pickupDate: new Date("2026-07-20T00:00:00.000Z"),
    dropoffDate: new Date("2026-07-22T00:00:00.000Z"),
    pickedUpAt: new Date("2026-07-20T01:00:00.000Z"),
    droppedAt: new Date("2026-07-22T01:00:00.000Z"),
    ...overrides,
  };
}

function conf(
  taskId: string,
  userId: string,
  event: "PICKED_UP" | "DROPPED",
  overrides: Partial<LaundryConfirmationLite> = {},
): LaundryConfirmationLite {
  return {
    laundryTaskId: taskId,
    confirmedById: userId,
    photoUrl: null,
    s3Key: null,
    notes: JSON.stringify({ event }),
    createdAt: new Date("2026-07-22T01:00:00.000Z"),
    ...overrides,
  };
}

function run(tasks: LaundryTaskLite[], confirmations: LaundryConfirmationLite[], userIds: string[] = []) {
  return computeLaundryTeamStats({ tasks, confirmations, rangeStart: RANGE_START, rangeEnd: NOW, now: NOW, userIds });
}

const userRow = (stats: ReturnType<typeof run>, userId: string) => {
  const row = stats.perUser.find((r) => r.userId === userId);
  if (!row) throw new Error(`no row for ${userId}`);
  return row;
};

describe("computeLaundryTeamStats", () => {
  it("counts an on-time drop (droppedAt before Sydney end-of-day of dropoffDate)", () => {
    // dropoffDate 22 Jul; Sydney EOD 22 Jul = 13:59:59.999Z. Dropped 01:00Z → on time.
    const t = task({ id: "t1" });
    const stats = run([t], [conf("t1", "u1", "PICKED_UP"), conf("t1", "u1", "DROPPED")]);
    const row = userRow(stats, "u1");
    expect(row.pickups).toBe(1);
    expect(row.drops).toBe(1);
    expect(row.onTimeDropPct).toBe(100);
    expect(stats.teamTotals.onTimeDropPct).toBe(100);
  });

  it("flags a late drop (after Sydney end-of-day, even if same UTC day)", () => {
    // 2026-07-22T14:30Z = 00:30 on 23 Jul in Sydney → past EOD of the 22nd → late.
    const t = task({ id: "t1", droppedAt: new Date("2026-07-22T14:30:00.000Z") });
    const stats = run([t], [conf("t1", "u1", "DROPPED")]);
    expect(userRow(stats, "u1").onTimeDropPct).toBe(0);
  });

  it("computes photo compliance from the drop confirmation's photo", () => {
    const tasks = [task({ id: "t1" }), task({ id: "t2" })];
    const stats = run(tasks, [
      conf("t1", "u1", "DROPPED", { photoUrl: "https://cdn/x.jpg" }),
      conf("t2", "u1", "DROPPED"), // no photo
    ]);
    expect(userRow(stats, "u1").photoCompliancePct).toBe(50);
    expect(stats.teamTotals.photoCompliancePct).toBe(50);
  });

  it("averages the pickup→drop cycle in days", () => {
    const tasks = [
      task({ id: "t1", pickedUpAt: new Date("2026-07-20T00:00:00.000Z"), droppedAt: new Date("2026-07-22T00:00:00.000Z") }), // 2d
      task({ id: "t2", pickedUpAt: new Date("2026-07-21T00:00:00.000Z"), droppedAt: new Date("2026-07-22T00:00:00.000Z") }), // 1d
    ];
    const stats = run(tasks, [conf("t1", "u1", "DROPPED"), conf("t2", "u1", "DROPPED")]);
    expect(userRow(stats, "u1").avgCycleDays).toBe(1.5);
  });

  it("detects stuck tasks older than 48h and leaves fresh ones alone", () => {
    const tasks = [
      // PICKED_UP 3 days ago → stuck, attributed to its pickup actor.
      task({ id: "stuck", status: "PICKED_UP", pickedUpAt: new Date("2026-07-22T00:00:00.000Z"), droppedAt: null }),
      // PICKED_UP 1 day ago → not stuck.
      task({ id: "fresh", status: "PICKED_UP", pickedUpAt: new Date("2026-07-24T00:00:00.000Z"), droppedAt: null }),
      // PENDING with pickupDate 4 days ago → stuck but unattributed (no actor yet).
      task({ id: "pending", status: "PENDING", pickupDate: new Date("2026-07-21T00:00:00.000Z"), pickedUpAt: null, droppedAt: null }),
    ];
    const stats = run(tasks, [conf("stuck", "u1", "PICKED_UP"), conf("fresh", "u1", "PICKED_UP")]);
    expect(userRow(stats, "u1").stuckCount).toBe(1);
    expect(stats.teamTotals.stuckCount).toBe(2);
    expect(stats.teamTotals.stuckUnattributed).toBe(1);
  });

  it("lists zero-activity users with empty stats", () => {
    const stats = run([], [], ["idle"]);
    expect(userRow(stats, "idle")).toEqual({
      userId: "idle",
      pickups: 0,
      drops: 0,
      onTimeDropPct: null,
      photoCompliancePct: null,
      avgCycleDays: null,
      stuckCount: 0,
    });
  });

  it("ignores activity outside the period window but still counts team totals per range", () => {
    const old = task({
      id: "old",
      pickedUpAt: new Date("2026-06-01T00:00:00.000Z"),
      droppedAt: new Date("2026-06-02T00:00:00.000Z"),
    });
    const stats = run([old], [conf("old", "u1", "PICKED_UP"), conf("old", "u1", "DROPPED")], ["u1"]);
    expect(userRow(stats, "u1").pickups).toBe(0);
    expect(userRow(stats, "u1").drops).toBe(0);
    expect(stats.teamTotals.drops).toBe(0);
  });

  it("attributes to the latest event confirmation after reverts", () => {
    const t = task({ id: "t1" });
    const stats = run(
      [t],
      [
        conf("t1", "u1", "DROPPED", { createdAt: new Date("2026-07-21T00:00:00.000Z") }),
        conf("t1", "u2", "DROPPED", { createdAt: new Date("2026-07-22T01:00:00.000Z") }),
      ],
    );
    expect(userRow(stats, "u2").drops).toBe(1);
    expect(stats.perUser.find((r) => r.userId === "u1")).toBeUndefined();
  });
});
