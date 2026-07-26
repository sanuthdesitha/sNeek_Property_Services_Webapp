import { describe, it, expect } from "vitest";
import {
  evaluateLaundryDelete,
  isLaundryTaskCompleted,
  isLaundryTaskSuppressed,
  stripTaskFromStops,
} from "@/lib/laundry/deletion";
import type { RouteStopJson } from "@/lib/laundry/route-plan";

const pending = { status: "PENDING" as const };
const dropped = { status: "DROPPED" as const, droppedAt: "2026-07-20T02:00:00Z" };

describe("isLaundryTaskCompleted", () => {
  it("is true for DROPPED and for anything carrying droppedAt", () => {
    expect(isLaundryTaskCompleted(dropped)).toBe(true);
    expect(isLaundryTaskCompleted({ status: "PICKED_UP", droppedAt: new Date() })).toBe(true);
  });

  it("is false while the set is still in flight", () => {
    expect(isLaundryTaskCompleted(pending)).toBe(false);
    expect(isLaundryTaskCompleted({ status: "PICKED_UP", pickedUpAt: new Date(), droppedAt: null })).toBe(false);
  });
});

describe("isLaundryTaskSuppressed", () => {
  it("only counts SKIPPED_PICKUP tasks flagged no-pickup", () => {
    expect(isLaundryTaskSuppressed({ status: "SKIPPED_PICKUP", noPickupRequired: true })).toBe(true);
    expect(isLaundryTaskSuppressed({ status: "SKIPPED_PICKUP", noPickupRequired: false })).toBe(false);
    expect(isLaundryTaskSuppressed({ status: "PENDING", noPickupRequired: true })).toBe(false);
  });
});

describe("evaluateLaundryDelete", () => {
  it("sends LAUNDRY users to the existing approval-request flow", () => {
    const decision = evaluateLaundryDelete({ role: "LAUNDRY", task: pending });
    expect(decision).toMatchObject({ ok: false, status: 403, code: "USE_APPROVAL_REQUEST" });
  });

  it("refuses any other non-admin role", () => {
    for (const role of ["CLEANER", "CLIENT", "QA_INSPECTOR", "MAINTENANCE"]) {
      expect(evaluateLaundryDelete({ role, task: pending })).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("lets ADMIN and OPS_MANAGER delete an in-flight set", () => {
    expect(evaluateLaundryDelete({ role: "ADMIN", task: pending })).toEqual({ ok: true });
    expect(evaluateLaundryDelete({ role: "OPS_MANAGER", task: { status: "PICKED_UP" } })).toEqual({ ok: true });
  });

  it("409s a completed set unless a full ADMIN forces it", () => {
    expect(evaluateLaundryDelete({ role: "ADMIN", task: dropped })).toMatchObject({
      ok: false,
      status: 409,
      code: "COMPLETED_TASK_NEEDS_FORCE",
    });
    expect(evaluateLaundryDelete({ role: "ADMIN", task: dropped, force: true })).toEqual({ ok: true });
  });

  it("never lets OPS_MANAGER force-delete a completed set", () => {
    expect(evaluateLaundryDelete({ role: "OPS_MANAGER", task: dropped, force: true })).toMatchObject({
      ok: false,
      status: 409,
      code: "COMPLETED_TASK",
    });
  });
});

describe("stripTaskFromStops", () => {
  const stop = (taskId: string, kind: "PICKUP" | "DROP", order: number): RouteStopJson => ({
    taskId,
    kind,
    order,
    propertyId: `p-${taskId}`,
  });

  it("removes every stop for the task and re-indexes the rest", () => {
    const stops = [stop("a", "PICKUP", 0), stop("b", "PICKUP", 1), stop("a", "DROP", 2), stop("c", "DROP", 3)];
    const result = stripTaskFromStops(stops, "a");
    expect(result.removed).toBe(2);
    expect(result.stops.map((s) => [s.taskId, s.order])).toEqual([
      ["b", 0],
      ["c", 1],
    ]);
  });

  it("returns the original array untouched when the task is not on the route", () => {
    const stops = [stop("b", "PICKUP", 0)];
    const result = stripTaskFromStops(stops, "zzz");
    expect(result.removed).toBe(0);
    expect(result.stops).toBe(stops);
  });
});
