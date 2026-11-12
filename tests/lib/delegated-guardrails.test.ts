/**
 * Owner decision 2026-11-12: administrator capabilities are grantable to one
 * person at a time, with server guardrails. One test per guardrail.
 */
import { describe, expect, it } from "vitest";
import { touchesOwnAccess } from "@/lib/rbac/access-diff";
import { delegatedPolicyRefusal } from "@/lib/rbac/delegated-edit";
import { EMPTY_OPS_POLICY, opsPolicySchema, type OpsPolicy } from "@/lib/rbac/ops-policy";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
import { delegatedDecision } from "@/lib/rbac/delegated-admin";

const editor = { id: "editor", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] };
const admin = { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"] };
const low = { id: "low", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] };
const high = { id: "high", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] };
const cleaner = { id: "cleaner", role: "CLEANER", heldRoles: ["CLEANER"] };
const subjects = { editor, admin, low, high, cleaner };

const base: OpsPolicy = opsPolicySchema.parse({
  ...EMPTY_OPS_POLICY,
  revision: 3,
  presets: [{ id: "custom-team", name: "Team", description: "", levels: { jobs: "manage" } }],
  assignments: {
    editor: { presetId: "coordinator", overrides: {}, capabilities: { "access.edit_permissions": true, "accounts.reset_password": true, "access.test_as": true } },
    low: { presetId: "observer", overrides: {} },
    high: { presetId: "existing", overrides: { finance: "full" } },
  },
});
const change = (mutate: (policy: OpsPolicy) => void): OpsPolicy => {
  const next = structuredClone(base);
  mutate(next);
  return next;
};

describe("delegated access editing (Edit access and permissions)", () => {
  it("allows raising someone below them up to the editor's own levels", () => {
    expect(delegatedPolicyRefusal(base, change((p) => { p.assignments.low.overrides.jobs = "manage"; }), editor, subjects)).toBeNull();
  });
  it("(b) refuses granting what the editor does not hold", () => {
    expect(delegatedPolicyRefusal(base, change((p) => { p.assignments.low.overrides.finance = "manage"; }), editor, subjects)).toBe("EXCEEDS_OWN_ACCESS");
    expect(delegatedPolicyRefusal(base, change((p) => { p.assignments.low.overrides.jobs = "full"; }), editor, subjects)).toBe("EXCEEDS_OWN_ACCESS");
  });
  it("(b) refuses changing their own access", () => {
    expect(delegatedPolicyRefusal(base, change((p) => { p.assignments.editor.overrides.finance = "manage"; }), editor, subjects)).toBe("SELF");
    expect(touchesOwnAccess(base, change((p) => { p.assignments.editor.overrides.jobs = "off"; }), "editor")).toBe(true);
  });
  it("(c) refuses granting or withdrawing administrator capabilities", () => {
    expect(delegatedPolicyRefusal(base, change((p) => { p.assignments.low.capabilities = { "access.test_as": true }; }), editor, subjects)).toBe("ADMIN_CAPABILITIES");
  });
  it("(a) refuses touching an administrator or someone with more access", () => {
    expect(delegatedPolicyRefusal(base, change((p) => { p.assignments.admin = { presetId: "observer", overrides: {} }; }), editor, subjects)).toBe("ADMIN_TARGET");
    expect(delegatedPolicyRefusal(base, change((p) => { p.assignments.high.overrides.finance = "read"; }), editor, subjects)).toBe("EXCEEDS_OWN_ACCESS");
  });
  it("refuses preset edits (they move many people at once)", () => {
    expect(delegatedPolicyRefusal(base, change((p) => { p.presets[0].levels.finance = "manage"; }), editor, subjects)).toBe("PRESETS");
  });
  it("administrators are not limited by these guardrails", () => {
    expect(delegatedPolicyRefusal(base, change((p) => { p.assignments.high.overrides.finance = "read"; p.presets = []; p.assignments.high.presetId = "existing"; }), admin, subjects)).toBeNull();
  });
});

describe("delegated actions on a person (password, two-step, Test as)", () => {
  it("(e) never while testing as someone", () => {
    expect(delegatedDecision(base, editor, "accounts.reset_password", low, true)).toMatchObject({ allowed: false });
    expect(delegatedDecision(base, admin, "accounts.reset_password", low, true)).toMatchObject({ allowed: false });
  });
  it("needs the person's own grant", () => {
    expect(delegatedDecision(base, low, "accounts.reset_password", cleaner, false)).toMatchObject({ allowed: false });
    expect(delegatedDecision(base, editor, "accounts.reset_two_step", cleaner, false)).toMatchObject({ allowed: false });
    expect(delegatedDecision(base, editor, "accounts.reset_password", cleaner, false)).toEqual({ allowed: true });
  });
  it("(a)(d) never on an administrator or anyone with more access, nor on themselves", () => {
    expect(delegatedDecision(base, editor, "accounts.reset_password", admin, false)).toMatchObject({ allowed: false });
    expect(delegatedDecision(base, editor, "access.test_as", high, false)).toMatchObject({ allowed: false });
    expect(delegatedDecision(base, editor, "access.test_as", editor, false)).toMatchObject({ allowed: false });
    expect(delegatedDecision(base, editor, "access.test_as", low, false)).toEqual({ allowed: true });
  });
  it("defaults: nobody but an administrator holds any of them", () => {
    for (const key of ["accounts.reset_password", "accounts.reset_two_step", "access.test_as", "access.edit_permissions"] as const) {
      expect(delegatedDecision(EMPTY_OPS_POLICY, low, key, cleaner, false)).toMatchObject({ allowed: false });
      expect(delegatedDecision(EMPTY_OPS_POLICY, admin, key, low, false)).toEqual({ allowed: true });
    }
  });
});
