// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { PERMISSIONS, type Permission } from "@/lib/rbac/permissions";
import { OPS_FEATURES } from "@/lib/rbac/ops-catalog";
import { ADMIN_ONLY_ACTIONS, REFERENCE_ROLES, defaultOpsManagerLevels, referenceRows, roleSummaries } from "@/lib/rbac/role-reference";

/**
 * Parity (2026-11-12): the old Roles settings had a base role reference. It
 * is back on Access and permissions, generated from the real role map and the
 * operations-manager area defaults, with what the access model changed.
 */
function row(permission: Permission) {
  const found = referenceRows().find((item) => item.permission === permission);
  if (!found) throw new Error(`no row for ${permission}`);
  return found;
}

describe("role reference", () => {
  it("has a summary for every role and one row per permission in the base map", () => {
    const summaries = roleSummaries();
    for (const role of Object.values(Role)) expect(summaries[role]).toBeTruthy();
    expect(REFERENCE_ROLES).toHaveLength(Object.values(Role).length);
    expect(referenceRows().map((item) => item.permission)).toEqual(Object.keys(PERMISSIONS));
  });

  it("generates the non-manager columns straight from the base map", () => {
    for (const item of referenceRows()) {
      const holders = new Set<Role>(PERMISSIONS[item.permission] as readonly Role[]);
      for (const role of REFERENCE_ROLES) {
        if (role === Role.OPS_MANAGER) continue;
        expect(item.cells[role].kind).toBe(holders.has(role) ? "granted" : "not-granted");
      }
    }
  });

  it("describes the operations manager from the real area default (Manage everywhere)", () => {
    const levels = defaultOpsManagerLevels();
    expect(Object.keys(levels)).toHaveLength(OPS_FEATURES.length);
    expect(new Set(Object.values(levels))).toEqual(new Set(["manage"]));
    expect(roleSummaries()[Role.OPS_MANAGER]).toContain(`Manage in every office area (${OPS_FEATURES.length})`);
    expect(row("jobs:read:all").cells[Role.OPS_MANAGER]).toEqual({ kind: "area-default", area: "Jobs & assignments", level: "Manage" });
  });

  it("corrects what the access model changed: sensitive deletes need Full, admin-only stays admin-only", () => {
    expect(row("jobs:delete").cells[Role.OPS_MANAGER]).toMatchObject({ kind: "needs-full", capability: "Delete jobs" });
    expect(row("clients:delete").cells[Role.OPS_MANAGER]).toMatchObject({ kind: "needs-full", capability: "Delete clients" });
    expect(row("properties:delete").cells[Role.OPS_MANAGER]).toMatchObject({ kind: "needs-full", capability: "Archive properties" });
    expect(row("pricebook:write").cells[Role.OPS_MANAGER]).toEqual({ kind: "admin-only" });
    expect(row("audit:read").cells[Role.OPS_MANAGER]).toEqual({ kind: "admin-only" });
    expect(row("jobs:start").cells[Role.OPS_MANAGER]).toEqual({ kind: "not-granted" });
    expect(ADMIN_ONLY_ACTIONS.length).toBeGreaterThan(0);
  });
});
