import { describe, it, expect } from "vitest";
import { Role } from "@prisma/client";
import {
  GRANTABLE_EXTRA_ROLES,
  ROLE_LABELS,
  canActAs,
  hasMultipleRoles,
  heldRoles,
  isGrantableExtraRole,
  portalHomeForRole,
  resolveActiveRole,
  switchableRoles,
} from "@/lib/auth/roles";

describe("heldRoles", () => {
  it("puts the primary first and keeps it there", () => {
    // Callers read [0] as "their real job".
    expect(heldRoles(Role.CLEANER, [Role.QA_INSPECTOR])).toEqual([
      Role.CLEANER,
      Role.QA_INSPECTOR,
    ]);
  });

  it("is just the primary when there are no extras", () => {
    // The zero-change case: an account that has always had one job must behave
    // exactly as it did before this table existed.
    expect(heldRoles(Role.CLEANER)).toEqual([Role.CLEANER]);
    expect(heldRoles(Role.CLEANER, [])).toEqual([Role.CLEANER]);
  });

  it("never duplicates the primary, even if a stray row repeats it", () => {
    expect(heldRoles(Role.CLEANER, [Role.CLEANER])).toEqual([Role.CLEANER]);
    expect(heldRoles(Role.CLEANER, [Role.CLEANER, Role.QA_INSPECTOR])).toEqual([
      Role.CLEANER,
      Role.QA_INSPECTOR,
    ]);
  });

  it("de-duplicates repeated extras", () => {
    expect(heldRoles(Role.CLEANER, [Role.QA_INSPECTOR, Role.QA_INSPECTOR])).toEqual([
      Role.CLEANER,
      Role.QA_INSPECTOR,
    ]);
  });
});

describe("canActAs", () => {
  it("passes when any held role satisfies the gate", () => {
    const held = heldRoles(Role.CLEANER, [Role.QA_INSPECTOR]);
    expect(canActAs(held, [Role.QA_INSPECTOR])).toBe(true);
    expect(canActAs(held, [Role.CLEANER])).toBe(true);
  });

  it("refuses when none does", () => {
    const held = heldRoles(Role.CLEANER, [Role.QA_INSPECTOR]);
    expect(canActAs(held, [Role.ADMIN])).toBe(false);
    expect(canActAs(held, [])).toBe(false);
  });

  it("is byte-for-byte the old check for a single-role account", () => {
    // 848 call sites depend on this equivalence.
    for (const role of Object.values(Role)) {
      expect(canActAs([role], [role])).toBe(true);
      const other = role === Role.ADMIN ? Role.CLEANER : Role.ADMIN;
      expect(canActAs([role], [other])).toBe(false);
    }
  });
});

describe("resolveActiveRole", () => {
  const held = heldRoles(Role.CLEANER, [Role.QA_INSPECTOR]);

  it("honours a request for a role they hold", () => {
    expect(resolveActiveRole(held, Role.QA_INSPECTOR, Role.CLEANER)).toBe(Role.QA_INSPECTOR);
  });

  it("falls back to the primary with no request", () => {
    expect(resolveActiveRole(held, null, Role.CLEANER)).toBe(Role.CLEANER);
    expect(resolveActiveRole(held, undefined, Role.CLEANER)).toBe(Role.CLEANER);
    expect(resolveActiveRole(held, "", Role.CLEANER)).toBe(Role.CLEANER);
  });

  it("IGNORES a request for a role they do not hold", () => {
    // This is the revocation path. An admin removing somebody's QA role must
    // take effect immediately; a cookie still naming it is a stale claim, not a
    // grant, and must never be honoured.
    expect(resolveActiveRole(held, Role.ADMIN, Role.CLEANER)).toBe(Role.CLEANER);
    expect(resolveActiveRole([Role.CLEANER], Role.QA_INSPECTOR, Role.CLEANER)).toBe(Role.CLEANER);
  });

  it("ignores junk without throwing", () => {
    // The cookie is user-editable, so it will eventually contain anything.
    expect(resolveActiveRole(held, "NOT_A_ROLE", Role.CLEANER)).toBe(Role.CLEANER);
    expect(resolveActiveRole(held, "  ", Role.CLEANER)).toBe(Role.CLEANER);
    expect(resolveActiveRole(held, "cleaner", Role.CLEANER)).toBe(Role.CLEANER);
  });
});

describe("hasMultipleRoles", () => {
  it("is false for a single-role account, so no switcher is shown", () => {
    expect(hasMultipleRoles([Role.CLEANER])).toBe(false);
  });

  it("is true once there is a second", () => {
    expect(hasMultipleRoles([Role.CLEANER, Role.QA_INSPECTOR])).toBe(true);
  });
});

describe("switchableRoles", () => {
  it("returns only portal-owning roles the person holds, in a stable order", () => {
    const held = heldRoles(Role.QA_INSPECTOR, [Role.CLEANER]);
    // Stable regardless of which is primary, so the switcher does not reshuffle
    // itself between people.
    expect(switchableRoles(held)).toEqual([Role.CLEANER, Role.QA_INSPECTOR]);
  });

  it("offers nothing to an admin, who already reaches every portal", () => {
    expect(switchableRoles([Role.ADMIN])).toEqual([]);
    expect(switchableRoles([Role.OPS_MANAGER])).toEqual([]);
  });

  it("never offers VA — a VA acts inside the client portal, it is not one", () => {
    expect(switchableRoles([Role.CLIENT, Role.VA])).toEqual([]);
  });
});

describe("GRANTABLE_EXTRA_ROLES", () => {
  it("REFUSES to hand out administrative access as a secondary hat", () => {
    // Promoting somebody to admin must be a deliberate change to their primary
    // role, never a checkbox on a list.
    expect(isGrantableExtraRole(Role.ADMIN)).toBe(false);
    expect(isGrantableExtraRole(Role.OPS_MANAGER)).toBe(false);
  });

  it("refuses the client-scoped roles", () => {
    // A person is a particular client's assistant, not generically "a VA" —
    // that scope comes from the client link, not from a role grant.
    expect(isGrantableExtraRole(Role.CLIENT)).toBe(false);
    expect(isGrantableExtraRole(Role.VA)).toBe(false);
  });

  it("allows the four working roles", () => {
    for (const role of [Role.CLEANER, Role.QA_INSPECTOR, Role.LAUNDRY, Role.MAINTENANCE]) {
      expect(isGrantableExtraRole(role), role).toBe(true);
    }
    expect(GRANTABLE_EXTRA_ROLES).toHaveLength(4);
  });
});

describe("labels and homes", () => {
  it("labels every role, so no switcher can render a raw enum name", () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_LABELS[role], role).toBeTruthy();
      expect(ROLE_LABELS[role]).not.toBe(role);
    }
  });

  it("gives every role a portal home", () => {
    for (const role of Object.values(Role)) {
      expect(portalHomeForRole(role), role).toMatch(/^\/v2\//);
    }
  });

  it("sends a VA to the client portal, where they actually work", () => {
    expect(portalHomeForRole(Role.VA)).toBe("/v2/client");
    expect(portalHomeForRole(Role.CLIENT)).toBe("/v2/client");
  });
});
