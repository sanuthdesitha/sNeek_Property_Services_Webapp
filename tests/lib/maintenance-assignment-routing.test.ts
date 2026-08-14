import { describe, it, expect } from "vitest";
import { JobTaskSource, MaintenanceStatus } from "@prisma/client";
import {
  buildJobTaskDraftFromMaintenance,
  parseAssignTarget,
  shouldCreateJobTaskOnAttach,
  statusAfterRouting,
  visitFieldsToClear,
} from "@/lib/maintenance/assignment-routing";

/**
 * CP-8, owner-confirmed: "clients may assign directly to a maintenance worker
 * OR to admin; from admin, admin reassigns to anyone, carrying the full record
 * across and auto-creating the job task on attach."
 */

describe("parseAssignTarget", () => {
  it("reads a worker id as assigning to that worker", () => {
    expect(parseAssignTarget("wkr_1")).toEqual({ kind: "WORKER", workerId: "wkr_1" });
  });

  it("reads an explicit null as 'send it to admin'", () => {
    expect(parseAssignTarget(null)).toEqual({ kind: "ADMIN" });
  });

  it("treats a blank string as admin rather than assigning to nobody", () => {
    expect(parseAssignTarget("   ")).toEqual({ kind: "ADMIN" });
  });

  it("returns null when the request is not about assignment at all", () => {
    // undefined must not be confused with null — one means "leave it alone",
    // the other means "route it to admin".
    expect(parseAssignTarget(undefined)).toBeNull();
  });
});

describe("statusAfterRouting", () => {
  it("acknowledges an open item when a worker takes it", () => {
    expect(statusAfterRouting(MaintenanceStatus.OPEN, { kind: "WORKER", workerId: "w" })).toBe(
      MaintenanceStatus.ACKNOWLEDGED
    );
  });

  it("puts an acknowledged item back to OPEN when routed to admin", () => {
    expect(statusAfterRouting(MaintenanceStatus.ACKNOWLEDGED, { kind: "ADMIN" })).toBe(
      MaintenanceStatus.OPEN
    );
  });

  it("never undoes real progress — routing is about WHO, not the work", () => {
    for (const status of [
      MaintenanceStatus.IN_PROGRESS,
      MaintenanceStatus.ORDERED,
      MaintenanceStatus.RESOLVED,
    ]) {
      expect(statusAfterRouting(status, { kind: "ADMIN" })).toBeNull();
      expect(statusAfterRouting(status, { kind: "WORKER", workerId: "w" })).toBeNull();
    }
  });
});

describe("visitFieldsToClear", () => {
  it("re-arms every visit stamp so a new worker does not inherit the last visit", () => {
    // Leaving arrivedAt set would show the new worker as already on site
    // somewhere they have never been.
    expect(visitFieldsToClear).toEqual({
      enRouteAt: null,
      arrivedAt: null,
      workStartedAt: null,
      clockInAt: null,
      clockOutAt: null,
      outcome: null,
    });
  });
});

describe("shouldCreateJobTaskOnAttach", () => {
  it("creates a task when the item is attached to a job", () => {
    expect(shouldCreateJobTaskOnAttach({ previousJobId: null, nextJobId: "job_1" })).toBe(true);
  });

  it("creates a task when the item moves to a different job", () => {
    expect(shouldCreateJobTaskOnAttach({ previousJobId: "job_1", nextJobId: "job_2" })).toBe(true);
  });

  it("does NOT duplicate a task when the job is unchanged", () => {
    // Re-saving an item already on job X must not mint a task every time.
    expect(shouldCreateJobTaskOnAttach({ previousJobId: "job_1", nextJobId: "job_1" })).toBe(false);
  });

  it("does nothing when there is no job to attach to", () => {
    expect(shouldCreateJobTaskOnAttach({ previousJobId: "job_1", nextJobId: null })).toBe(false);
    expect(shouldCreateJobTaskOnAttach({ previousJobId: null, nextJobId: "  " })).toBe(false);
  });
});

describe("buildJobTaskDraftFromMaintenance", () => {
  it("marks the task as maintenance and demands photo evidence", () => {
    const draft = buildJobTaskDraftFromMaintenance({
      title: "Cracked shower screen",
      description: "Glass panel cracked",
    });
    expect(draft.title).toBe("Maintenance: Cracked shower screen");
    expect(draft.description).toBe("Glass panel cracked");
    expect(draft.requiresPhoto).toBe(true);
    // Invisible to the cleaner would make attaching pointless.
    expect(draft.visibleToCleaner).toBe(true);
  });

  it("attributes the task to the client when the client raised the item", () => {
    expect(buildJobTaskDraftFromMaintenance({ title: "x", raisedByClient: true }).source).toBe(
      JobTaskSource.CLIENT
    );
    expect(buildJobTaskDraftFromMaintenance({ title: "x" }).source).toBe(JobTaskSource.ADMIN);
  });

  it("falls back to a usable title and keeps it inside the column limit", () => {
    expect(buildJobTaskDraftFromMaintenance({ title: "  " }).title).toBe(
      "Maintenance: Maintenance item"
    );
    expect(
      buildJobTaskDraftFromMaintenance({ title: "x".repeat(400) }).title.length
    ).toBeLessThanOrEqual(180);
  });

  it("nulls an empty description rather than storing whitespace", () => {
    expect(
      buildJobTaskDraftFromMaintenance({ title: "x", description: "   " }).description
    ).toBeNull();
  });
});
