/**
 * Pure decision helpers behind DELETE /api/laundry/[taskId].
 *
 * WHY TWO MODES (this is the important bit):
 * `LaundryTask.jobId` is `@unique` and the planner RECREATES a task from its
 * job — `ensureLaundryTaskForJob`, the weekly plan (`applyLaundryPlanDraft`)
 * and the per-property resync all upsert on `jobId`. So a plain row delete is
 * not durable: the very next planner run brings the task straight back.
 *
 * Therefore:
 *   • SUPPRESS (the default, "Remove from the board") is a SOFT delete —
 *     status SKIPPED_PICKUP + noPickupRequired, which every laundry board
 *     already filters out, and which `canPlannerOverrideStatus` refuses to
 *     touch. This is the durable one.
 *   • PERMANENT ("Delete permanently") really does drop the row (and its
 *     confirmations). It is only durable while the source job stays gone /
 *     laundry-disabled — if the turnover job still exists with laundryEnabled,
 *     the planner will legitimately create a fresh task for it again.
 *
 * No Prisma / no fetch here: unit-tested in tests/lib/laundry-deletion.test.ts.
 */
import type { Role } from "@prisma/client";
import type { RouteStopJson } from "@/lib/laundry/route-plan";

export type LaundryDeleteMode = "SUPPRESS" | "PERMANENT";

/** The skip reason a suppressed (admin-deleted) task carries. */
export const LAUNDRY_DELETE_SKIP_REASON = "ADMIN_INSTRUCTION";

export type DeletableTask = {
  status: string;
  pickedUpAt?: Date | string | null;
  droppedAt?: Date | string | null;
};

/** Completed = the linen round-trip actually finished; deleting rewrites history. */
export function isLaundryTaskCompleted(task: DeletableTask): boolean {
  return task.status === "DROPPED" || Boolean(task.droppedAt);
}

/** Already suppressed by a previous delete (or any other skip). */
export function isLaundryTaskSuppressed(task: {
  status: string;
  noPickupRequired?: boolean | null;
}): boolean {
  return task.status === "SKIPPED_PICKUP" && task.noPickupRequired === true;
}

export type DeleteRefusal = {
  ok: false;
  /** HTTP status the route should return. */
  status: 403 | 409;
  code:
    | "USE_APPROVAL_REQUEST"
    | "FORBIDDEN"
    | "COMPLETED_TASK"
    | "COMPLETED_TASK_NEEDS_FORCE";
  message: string;
};

export type DeleteDecision = { ok: true } | DeleteRefusal;

/**
 * Who may delete what.
 *
 *  - LAUNDRY users may NOT delete. They already have the failed-pickup
 *    "request skip/delete approval" path (POST …/status FAILED_PICKUP_REQUEST)
 *    and that stays the only route for them.
 *  - ADMIN / OPS_MANAGER may delete an in-flight task.
 *  - A completed (DROPPED / droppedAt) task is refused with 409 — unless the
 *    caller is a full ADMIN passing an explicit `force`.
 */
export function evaluateLaundryDelete(input: {
  role: Role | string;
  task: DeletableTask;
  force?: boolean;
}): DeleteDecision {
  const { role, task, force } = input;

  if (role === "LAUNDRY") {
    return {
      ok: false,
      status: 403,
      code: "USE_APPROVAL_REQUEST",
      message:
        "Laundry accounts can't delete a task. Use Failed pickup → request skip/delete approval and an admin will action it.",
    };
  }
  if (role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "FORBIDDEN" };
  }

  if (isLaundryTaskCompleted(task)) {
    if (role !== "ADMIN") {
      return {
        ok: false,
        status: 409,
        code: "COMPLETED_TASK",
        message: "This set has already been returned. Only a full admin can delete a completed task.",
      };
    }
    if (!force) {
      return {
        ok: false,
        status: 409,
        code: "COMPLETED_TASK_NEEDS_FORCE",
        message:
          "This set has already been returned — deleting it removes completed evidence and cost data. Confirm the forced delete to continue.",
      };
    }
  }

  return { ok: true };
}

/**
 * Remove every stop belonging to `taskId` from a route's stops JSON and
 * re-index the survivors 0..n-1 so the runner's "stop X of Y" stays honest.
 */
export function stripTaskFromStops(
  stops: RouteStopJson[],
  taskId: string,
): { stops: RouteStopJson[]; removed: number } {
  const kept = stops.filter((stop) => stop.taskId !== taskId);
  if (kept.length === stops.length) return { stops, removed: 0 };
  const reindexed = [...kept]
    .sort((a, b) => a.order - b.order)
    .map((stop, index) => ({ ...stop, order: index }));
  return { stops: reindexed, removed: stops.length - kept.length };
}
