import { describe, expect, it } from "vitest";
import { accessWithin, capabilitySource, effectiveCapabilities, evaluateCapability } from "@/lib/rbac/access-evaluator";
import { applyPreset, changedPeople, copyAccess, setPersonCapability, setPersonLevel } from "@/lib/rbac/access-draft";
import { describeAccess } from "@/lib/rbac/access-plain-language";
import { personSummaryLine } from "@/lib/rbac/access-screen-types";
import { allOpsLevels, canUseOpsPath, ownerRouteCapability } from "@/lib/rbac/ops-catalog";
import { EMPTY_OPS_POLICY, opsPolicySchema, resolveOpsLevels, type OpsPolicy } from "@/lib/rbac/ops-policy";

const ops = (id = "m") => ({ id, role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] });
const policyWith = (assignments: OpsPolicy["assignments"], presets: OpsPolicy["presets"] = []) =>
  opsPolicySchema.parse({ ...EMPTY_OPS_POLICY, presets, assignments });

describe("per-person access", () => {
  it("a person's override beats the preset, in both directions", () => {
    const policy = policyWith({ m: { presetId: "coordinator", overrides: { jobs: "off", finance: "manage" } } });
    const levels = resolveOpsLevels(policy, "m");
    expect(levels.jobs).toBe("off");
    expect(levels.finance).toBe("manage");
    expect(levels.calendar).toBe("manage");
    expect(levels.reports).toBe("read");
  });

  it("a person's capability switch beats the preset's", () => {
    const presets = [{ id: "custom-a", name: "A", description: "", levels: { jobs: "manage" as const }, capabilities: { "jobs.cancel": false } }];
    expect(evaluateCapability(policyWith({ m: { presetId: "custom-a", overrides: {} } }, presets), ops(), "jobs.cancel")).toBe(false);
    expect(evaluateCapability(policyWith({ m: { presetId: "custom-a", overrides: {}, capabilities: { "jobs.cancel": true } } }, presets), ops(), "jobs.cancel")).toBe(true);
  });

  it("a `true` switch never widens past the area level", () => {
    const policy = policyWith({ m: { presetId: "observer", overrides: {}, capabilities: { "invoices.send": true } } });
    expect(evaluateCapability(policy, ops(), "invoices.send")).toBe(false);
  });
});

describe("Full versus Manage", () => {
  it("sensitive capabilities come with Full only, unless granted individually; Manage never grants them", () => {
    const manage = policyWith({ m: { presetId: "existing", overrides: { jobs: "manage" } } });
    const full = policyWith({ m: { presetId: "existing", overrides: { jobs: "full" } } });
    const withheld = policyWith({ m: { presetId: "existing", overrides: { jobs: "full" }, sensitive: { "jobs.delete": false } } });
    const individual = policyWith({ m: { presetId: "existing", overrides: { jobs: "manage" }, sensitive: { "jobs.reset": true } } });
    expect(evaluateCapability(manage, ops(), "jobs.delete")).toBe(false);
    expect(evaluateCapability(full, ops(), "jobs.delete")).toBe(true);
    expect(evaluateCapability(full, ops(), "jobs.reset")).toBe(true);
    expect(evaluateCapability(withheld, ops(), "jobs.delete")).toBe(false);
    expect(evaluateCapability(individual, ops(), "jobs.reset")).toBe(true);
    expect(capabilitySource(individual, "m", "jobs.reset")).toBe("granted-individually");
    expect(capabilitySource(manage, "m", "jobs.delete")).toBe("needs-full");
  });

  it("Full and Manage route identically (middleware, path guard, office sends)", () => {
    const full = policyWith({ m: { presetId: "existing", overrides: { finance: "full" } } });
    expect(resolveOpsLevels(full, "m").finance).toBe("manage");
    expect(canUseOpsPath(resolveOpsLevels(full, "m"), "/api/admin/invoices/one", "PATCH")).toBe(true);
  });
});

describe("administrator capabilities", () => {
  it("are off for every non-administrator until granted to that person, and never through a preset", () => {
    expect(evaluateCapability(EMPTY_OPS_POLICY, ops(), "accounts.reset_password")).toBe(false);
    expect(evaluateCapability(policyWith({ m: { presetId: "existing", overrides: {}, capabilities: { "accounts.reset_password": true } } }), ops(), "accounts.reset_password")).toBe(true);
    expect(evaluateCapability(EMPTY_OPS_POLICY, { id: "a", role: "ADMIN", heldRoles: ["ADMIN"] }, "access.test_as")).toBe(true);
    const parsed = opsPolicySchema.safeParse({ ...EMPTY_OPS_POLICY, presets: [{ id: "custom-x", name: "X", description: "", levels: {}, capabilities: { "access.test_as": true } }] });
    expect(parsed.success).toBe(false);
  });

  it("open only their own owner routes, and only with the grant (middleware and route guard agree)", () => {
    const levels = allOpsLevels("manage");
    expect(ownerRouteCapability("/api/admin/users/u/reset-password")).toBe("accounts.reset_password");
    expect(canUseOpsPath(levels, "/api/admin/users/u/reset-password", "POST")).toBe(false);
    expect(canUseOpsPath(levels, "/api/admin/users/u/reset-password", "POST", ["accounts.reset_password"])).toBe(true);
    expect(canUseOpsPath(levels, "/api/admin/users/u/disable-2fa", "POST", ["accounts.reset_password"])).toBe(false);
    expect(canUseOpsPath(levels, "/v2/admin/settings/access", "GET", ["access.edit_permissions"])).toBe(true);
    expect(canUseOpsPath(levels, "/v2/admin/system/test-as", "GET", ["access.test_as"])).toBe(true);
    // What stays admin-only is never opened by any grant.
    const every = ["accounts.reset_password", "accounts.reset_two_step", "access.test_as", "access.edit_permissions"] as const;
    for (const path of ["/api/admin/users/u/roles", "/api/admin/integrations/credentials", "/api/admin/system/restore", "/api/admin/settings/audit", "/v2/admin/settings?tab=insights-email", "/v2/admin/settings?tab=portals"]) {
      expect(canUseOpsPath(levels, path, "POST", every), path).toBe(false);
    }
  });
});

describe("access within reach (guardrails a and d)", () => {
  const policy = policyWith({
    low: { presetId: "observer", overrides: {} },
    high: { presetId: "existing", overrides: {}, capabilities: { "access.test_as": true } },
    peer: { presetId: "existing", overrides: {} },
  });
  it("administrators are out of reach of everyone but administrators", () => {
    const adminTarget = { id: "a2", role: "ADMIN", heldRoles: ["ADMIN"] };
    expect(accessWithin(policy, adminTarget, ops("high"))).toBe(false);
    expect(accessWithin(policy, adminTarget, { id: "a1", role: "ADMIN" })).toBe(true);
    expect(accessWithin(policy, { id: "x", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER", "ADMIN"] }, ops("high"))).toBe(false);
  });
  it("someone with more access (a level or a capability) is out of reach", () => {
    expect(accessWithin(policy, ops("low"), ops("high"))).toBe(true);
    expect(accessWithin(policy, ops("high"), ops("low"))).toBe(false);
    expect(accessWithin(policy, ops("high"), ops("peer"))).toBe(false);
    expect(accessWithin(policy, ops("peer"), ops("high"))).toBe(true);
  });
  it("staff with no office access are within reach; a non-office actor reaches no office person", () => {
    expect(accessWithin(policy, { id: "c", role: "CLEANER", heldRoles: ["CLEANER"] }, ops("low"))).toBe(true);
    expect(accessWithin(policy, ops("low"), { id: "c", role: "CLEANER", heldRoles: ["CLEANER"] })).toBe(false);
  });
});

describe("draft edits", () => {
  it("Start from replaces levels and switches but keeps administrator grants; copy keeps the target's grants", () => {
    let policy = policyWith({ m: { presetId: "existing", overrides: { jobs: "off" }, capabilities: { "jobs.cancel": false, "access.test_as": true } }, n: { presetId: "coordinator", overrides: { finance: "full" } } });
    policy = applyPreset(policy, "m", "observer");
    expect(policy.assignments.m).toEqual({ presetId: "observer", overrides: {}, capabilities: { "access.test_as": true } });
    policy = copyAccess(policy, "n", "m");
    expect(policy.assignments.m).toMatchObject({ presetId: "coordinator", overrides: { finance: "full" }, capabilities: { "access.test_as": true } });
  });
  it("setting a level back to the saved one is no change", () => {
    const saved = policyWith({});
    const draft = setPersonLevel(setPersonLevel(saved, "m", "jobs", "off"), "m", "jobs", "manage");
    expect(changedPeople(draft, saved)).toEqual([]);
    expect(changedPeople(setPersonCapability(saved, "m", "jobs.cancel", false), saved)).toEqual(["m"]);
  });
  it("switching a sensitive capability off at Full stores a withholding; on at Full clears it", () => {
    const full = setPersonLevel(policyWith({}), "m", "cases", "full");
    const off = setPersonCapability(full, "m", "cases.delete", false);
    expect(off.assignments.m.sensitive).toEqual({ "cases.delete": false });
    expect(setPersonCapability(off, "m", "cases.delete", true).assignments.m.sensitive).toBeUndefined();
  });
});

describe("plain language and summaries", () => {
  it("describes the bookings assistant and marks Finance at View as a look-only area", () => {
    const policy = setPersonLevel(policyWith({ p: { presetId: "assistant-bookings", overrides: {} } }), "p", "finance", "read");
    const text = describeAccess(policy, "p");
    expect(text.can).toContain("Create, reschedule and assign jobs");
    expect(text.can.find((line) => line.startsWith("Look at"))).toContain("finance and invoicing");
    expect(text.cannot).toContain("Approve draft invoices");
    expect(effectiveCapabilities(policy, "p")["invoices.view"]).toBe(true);
    expect(personSummaryLine(policy, { id: "p", name: "Priya", email: null, role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"], twoFactorEnabled: true, createdAt: "2026-08-21T00:00:00Z" })).toBe("Assistant: bookings · 12 of 34 areas");
  });
});
