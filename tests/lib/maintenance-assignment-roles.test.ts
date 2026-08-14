import { describe, it, expect } from "vitest";
import { MaintenanceAssigneeRole, Role } from "@prisma/client";
import {
  activeAssignments,
  assignedRolesForUser,
  assigneeRoleForUserRole,
  canSeeMaintenanceSection,
  diffAssignees,
  groupAssignmentsByRole,
  isActiveAssignment,
  userRoleForAssigneeRole,
} from "@/lib/maintenance/assignment-roles";

/**
 * CP-6 gating. "The section appears in their portal only when assigned" is a
 * visibility rule, so it gets real cover: an un-assigned user must never be let
 * in, and a REMOVED assignment must stop counting even though its row survives.
 */
const REMOVED_AT = new Date("2026-08-01T00:00:00.000Z");

const rows = [
  { userId: "worker-1", role: MaintenanceAssigneeRole.MAINTENANCE, removedAt: null },
  { userId: "cleaner-1", role: MaintenanceAssigneeRole.CLEANER, removedAt: null },
  { userId: "qa-1", role: MaintenanceAssigneeRole.QA, removedAt: null },
  { userId: "cleaner-2", role: MaintenanceAssigneeRole.CLEANER, removedAt: REMOVED_AT },
];

describe("assigneeRoleForUserRole", () => {
  it("maps the three assignable account roles to their maintenance hat", () => {
    expect(assigneeRoleForUserRole(Role.MAINTENANCE)).toBe(MaintenanceAssigneeRole.MAINTENANCE);
    expect(assigneeRoleForUserRole(Role.CLEANER)).toBe(MaintenanceAssigneeRole.CLEANER);
    expect(assigneeRoleForUserRole(Role.QA_INSPECTOR)).toBe(MaintenanceAssigneeRole.QA);
  });

  it("returns null for roles that manage maintenance rather than being assigned it", () => {
    expect(assigneeRoleForUserRole(Role.ADMIN)).toBeNull();
    expect(assigneeRoleForUserRole(Role.OPS_MANAGER)).toBeNull();
    expect(assigneeRoleForUserRole(Role.CLIENT)).toBeNull();
    expect(assigneeRoleForUserRole(Role.LAUNDRY)).toBeNull();
  });

  it("round-trips through userRoleForAssigneeRole", () => {
    for (const role of [
      MaintenanceAssigneeRole.MAINTENANCE,
      MaintenanceAssigneeRole.CLEANER,
      MaintenanceAssigneeRole.QA,
    ]) {
      expect(assigneeRoleForUserRole(userRoleForAssigneeRole(role))).toBe(role);
    }
  });
});

describe("isActiveAssignment / activeAssignments", () => {
  it("treats a null removedAt as active and a stamped one as not", () => {
    expect(isActiveAssignment({ removedAt: null })).toBe(true);
    expect(isActiveAssignment({ removedAt: REMOVED_AT })).toBe(false);
  });

  it("drops removed rows while keeping the rest", () => {
    expect(activeAssignments(rows).map((r) => r.userId)).toEqual(["worker-1", "cleaner-1", "qa-1"]);
  });
});

describe("groupAssignmentsByRole", () => {
  it("keeps the three roles separately addressable and excludes removed rows", () => {
    const grouped = groupAssignmentsByRole(rows);
    expect(grouped[MaintenanceAssigneeRole.MAINTENANCE].map((r) => r.userId)).toEqual(["worker-1"]);
    expect(grouped[MaintenanceAssigneeRole.CLEANER].map((r) => r.userId)).toEqual(["cleaner-1"]);
    expect(grouped[MaintenanceAssigneeRole.QA].map((r) => r.userId)).toEqual(["qa-1"]);
  });

  it("returns an entry for every role even when nobody is assigned", () => {
    const grouped = groupAssignmentsByRole([]);
    expect(grouped[MaintenanceAssigneeRole.MAINTENANCE]).toEqual([]);
    expect(grouped[MaintenanceAssigneeRole.CLEANER]).toEqual([]);
    expect(grouped[MaintenanceAssigneeRole.QA]).toEqual([]);
  });
});

describe("assignedRolesForUser", () => {
  it("lists only that user's active hats", () => {
    expect(assignedRolesForUser(rows, "cleaner-1")).toEqual([MaintenanceAssigneeRole.CLEANER]);
    expect(assignedRolesForUser(rows, "worker-1")).toEqual([MaintenanceAssigneeRole.MAINTENANCE]);
  });

  it("gives a removed assignee nothing", () => {
    expect(assignedRolesForUser(rows, "cleaner-2")).toEqual([]);
  });

  it("can report more than one hat for the same person", () => {
    const dual = [
      { userId: "u1", role: MaintenanceAssigneeRole.CLEANER, removedAt: null },
      { userId: "u1", role: MaintenanceAssigneeRole.QA, removedAt: null },
    ];
    expect(assignedRolesForUser(dual, "u1")).toHaveLength(2);
  });
});

describe("canSeeMaintenanceSection", () => {
  it("admits an actively assigned user", () => {
    expect(canSeeMaintenanceSection(rows, "cleaner-1")).toBe(true);
    expect(canSeeMaintenanceSection(rows, "qa-1")).toBe(true);
  });

  it("refuses a user who was never assigned", () => {
    expect(canSeeMaintenanceSection(rows, "stranger")).toBe(false);
  });

  it("refuses a user whose assignment was removed, even though the row survives", () => {
    expect(canSeeMaintenanceSection(rows, "cleaner-2")).toBe(false);
  });

  it("refuses everyone when there are no assignments at all", () => {
    expect(canSeeMaintenanceSection([], "cleaner-1")).toBe(false);
  });
});

describe("diffAssignees", () => {
  it("splits a new roster into added, kept and removed", () => {
    const result = diffAssignees(["a", "b"], ["b", "c"]);
    expect(result.added).toEqual(["c"]);
    expect(result.kept).toEqual(["b"]);
    expect(result.removed).toEqual(["a"]);
  });

  // Only `added` is emailed, so an unchanged re-save must not re-notify anyone.
  it("adds nobody when the roster is unchanged, whatever the order", () => {
    const result = diffAssignees(["a", "b"], ["b", "a"]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual(["b", "a"]);
  });

  it("treats an empty new roster as removing everyone and adding nobody", () => {
    const result = diffAssignees(["a", "b"], []);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(["a", "b"]);
  });

  it("de-duplicates a repeated id rather than emailing twice", () => {
    const result = diffAssignees([], ["a", "a", "b"]);
    expect(result.added).toEqual(["a", "b"]);
  });
});
