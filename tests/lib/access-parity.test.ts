/**
 * PARITY: with no administrator edit, the shared capability evaluator answers
 * exactly as the rules in force before the 2026-11 access redesign, for every
 * capability and every kind of account. "Today" is written out independently
 * here from the old rules:
 *   - ADMIN (primary or extra): everything.
 *   - OPS_MANAGER: the route guard of the capability's area (View = safe
 *     methods, Manage = writes), the office-send rule (pack at "manage"), the
 *     urgent-stock rule (inventory "manage" for writes), and for sensitive
 *     actions an explicit grant (resolveSensitiveGrants) on top of Manage.
 *     Administrator capabilities were ADMIN only.
 *   - Anyone else (cleaner, client, revoked manager): none of these.
 */
import { describe, expect, it } from "vitest";
import { capabilityFromParts, evaluateCapability, type AccessSubject } from "@/lib/rbac/access-evaluator";
import { CAPABILITIES, type CapabilityKey } from "@/lib/rbac/capabilities";
import { allOpsLevels, canUseOpsPath, OPS_FEATURE_KEYS, type OpsLevel, type OpsLevels } from "@/lib/rbac/ops-catalog";
import { EMPTY_OPS_POLICY, opsPolicySchema, resolveOpsLevels, resolveSensitiveGrants, type OpsPolicy } from "@/lib/rbac/ops-policy";
import { decideOfficeSend, OFFICE_SEND_POLICIES, type OfficeSendAction } from "@/lib/notifications/office-send-rules";
import { inventoryLevelAllows } from "@/lib/inventory/urgent-stock-access";

const OFFICE_SEND_CAPABILITY: Record<OfficeSendAction, CapabilityKey> = {
  supplier_chase: "laundry.supplier_chase",
  guest_message: "lostfound.guest_message",
  lost_item_client_notice: "lostfound.client_notice",
  client_delay_notice: "jobs.client_delay_notice",
  clock_pause: "jobs.clock_pause",
  account_email: "accounts.account_email",
  // New capability (owner decision 2026-11-13, "Message team"): the Jobs pack rule, like the other job sends.
  job_team_message: "jobs.team_message",
};

/**
 * THE ONE INTENDED CHANGE, recorded deliberately (owner decision 2026-11-13):
 * "Void and credit notes" moved from the Manage tier to the Full (sensitive)
 * tier. Before, any operations manager at Finance Manage could void and raise
 * credit notes; now it takes Finance at Full or the explicit sensitive grant,
 * plus the person's own PIN at the moment of use. Managers who had it at
 * Manage lose it until granted (accepted by the owner). Every other
 * capability still reproduces the earlier rules exactly.
 */
const INTENDED_CHANGES: Readonly<Partial<Record<CapabilityKey, string>>> = {
  "invoices.void_credit": "Owner decision 2026-11-13: void and credit notes is a sensitive action (was Manage).",
};

/** The rule in force for an intended change: Full tier, explicit grant on top of Manage. */
function intendedAnswer(policy: OpsPolicy, subject: AccessSubject, key: CapabilityKey): boolean {
  const roles = subject.heldRoles ?? [subject.role];
  if (subject.role === "ADMIN" || roles.includes("ADMIN")) return true;
  if (!roles.includes("OPS_MANAGER")) return false;
  const capability = CAPABILITIES.find((item) => item.key === key)!;
  const manage = resolveOpsLevels(policy, subject.id)[capability.area!] === "manage";
  return manage && resolveSensitiveGrants(policy, subject.id)[capability.sensitiveAction!] === true;
}

/** The pre-redesign answer, from the old rules only (intended changes use the new rule). */
function todaysAnswer(policy: OpsPolicy, subject: AccessSubject, key: CapabilityKey): boolean {
  if (INTENDED_CHANGES[key]) return intendedAnswer(policy, subject, key);
  const roles = subject.heldRoles ?? [subject.role];
  if (subject.role === "ADMIN" || roles.includes("ADMIN")) return true;
  if (!roles.includes("OPS_MANAGER")) return false;
  const capability = CAPABILITIES.find((item) => item.key === key)!;
  if (capability.tier === "grant") return false;
  const levels = resolveOpsLevels(policy, subject.id);
  const level = levels[capability.area!];
  if (capability.tier === "view") return canUseOpsPath(levels, "/api/admin/" + routeFor(capability.area!), "GET") || level !== "off";
  const manage = level === "manage";
  if (capability.tier === "manage") return manage;
  return manage && resolveSensitiveGrants(policy, subject.id)[capability.sensitiveAction!] === true;
}
function routeFor(area: string) {
  return area === "finance" ? "invoices" : area === "communications" ? "messages" : "jobs";
}

const LEVELS: OpsLevel[] = ["off", "read", "manage"];
const uniform = (level: OpsLevel): OpsPolicy =>
  opsPolicySchema.parse({ ...EMPTY_OPS_POLICY, assignments: { m: { presetId: "existing", overrides: allOpsLevels(level) } } });
const ops: AccessSubject = { id: "m", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] };

describe("defaults reproduce today's access for every capability", () => {
  const subjects: Array<[string, AccessSubject]> = [
    ["ADMIN", { id: "a", role: "ADMIN", heldRoles: ["ADMIN"] }],
    ["OPS_MANAGER with ADMIN extra role", { id: "m", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER", "ADMIN"] }],
    ["unassigned OPS_MANAGER", ops],
    ["CLEANER with OPS_MANAGER extra role", { id: "m", role: "CLEANER", heldRoles: ["CLEANER", "OPS_MANAGER"] }],
    ["CLEANER with QA extra role", { id: "c", role: "CLEANER", heldRoles: ["CLEANER", "QA_INSPECTOR"] }],
    // A revoked manager: the live guard re-reads roles, so the subject no longer holds OPS_MANAGER.
    ["revoked manager (now CLEANER)", { id: "m", role: "CLEANER", heldRoles: ["CLEANER"] }],
    // Impersonation swaps the session to the target before any check (heldRoles = [target.role]).
    ["administrator testing as a manager (target)", { id: "m", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] }],
    ["administrator testing as a cleaner (target)", { id: "c", role: "CLEANER", heldRoles: ["CLEANER"] }],
    ["client", { id: "x", role: "CLIENT", heldRoles: ["CLIENT"] }],
  ];
  for (const [label, subject] of subjects) {
    it(`${label}, empty policy`, () => {
      for (const capability of CAPABILITIES) {
        expect(evaluateCapability(EMPTY_OPS_POLICY, subject, capability.key), capability.key).toBe(todaysAnswer(EMPTY_OPS_POLICY, subject, capability.key));
      }
    });
  }

  it.each(LEVELS)("OPS_MANAGER with every pack at %s", (level) => {
    const policy = uniform(level);
    for (const capability of CAPABILITIES) {
      expect(evaluateCapability(policy, ops, capability.key), `${level} ${capability.key}`).toBe(todaysAnswer(policy, ops, capability.key));
    }
  });

  it("OPS_MANAGER with explicit sensitive grants from the earlier screen, at each level", () => {
    for (const level of LEVELS) {
      const policy = opsPolicySchema.parse({
        ...EMPTY_OPS_POLICY,
        presets: [{ id: "custom-lead", name: "Lead", description: "", levels: allOpsLevels(level), sensitive: { "jobs.delete": true, "cases.delete": true } }],
        assignments: { m: { presetId: "custom-lead", overrides: {}, sensitive: { "cases.delete": false, "invoices.correct": true } } },
      });
      for (const capability of CAPABILITIES) {
        expect(evaluateCapability(policy, ops, capability.key), `${level} ${capability.key}`).toBe(todaysAnswer(policy, ops, capability.key));
      }
    }
  });

  it("each area at each level, one at a time (built-in presets)", () => {
    for (const presetId of ["existing", "observer", "coordinator", "assistant-bookings", "assistant-finance", "restricted"]) {
      const policy = opsPolicySchema.parse({ ...EMPTY_OPS_POLICY, assignments: { m: { presetId, overrides: {} } } });
      for (const capability of CAPABILITIES) {
        expect(evaluateCapability(policy, ops, capability.key), `${presetId} ${capability.key}`).toBe(todaysAnswer(policy, ops, capability.key));
      }
    }
  });
});

describe("the evaluator agrees with the enforcement points it now sits behind", () => {
  it("office sends: capability === decideOfficeSend at every level", () => {
    for (const action of Object.keys(OFFICE_SEND_POLICIES) as OfficeSendAction[]) {
      for (const level of LEVELS) {
        const levels: OpsLevels = { ...allOpsLevels("manage"), [OFFICE_SEND_POLICIES[action].pack]: level };
        const policy = opsPolicySchema.parse({ ...EMPTY_OPS_POLICY, assignments: { m: { presetId: "existing", overrides: levels } } });
        const before = decideOfficeSend({ heldRoles: ["OPS_MANAGER"], impersonating: false, levels }, action).allowed;
        expect(evaluateCapability(policy, ops, OFFICE_SEND_CAPABILITY[action]), `${action} ${level}`).toBe(before);
      }
    }
  });

  it("urgent stock writes: capability === inventoryLevelAllows(manage)", () => {
    for (const level of LEVELS) {
      expect(evaluateCapability(uniform(level), ops, "inventory.urgent_stock_act")).toBe(inventoryLevelAllows(level, "manage"));
    }
  });

  it("invoice writes: capability === the finance route guard for a write", () => {
    for (const level of LEVELS) {
      const levels = resolveOpsLevels(uniform(level), "m");
      // invoices.void_credit left this list on purpose (owner decision 2026-11-13): see below.
      for (const key of ["invoices.approve", "invoices.send", "invoices.record_payment"] as CapabilityKey[]) {
        expect(evaluateCapability(uniform(level), ops, key)).toBe(canUseOpsPath(levels, "/api/admin/invoices/one", "PATCH"));
      }
    }
  });

  it("the recorded exception: void and credit notes needs Finance at Full or the grant (owner decision 2026-11-13)", () => {
    expect(Object.keys(INTENDED_CHANGES)).toEqual(["invoices.void_credit"]);
    const definition = CAPABILITIES.find((item) => item.key === "invoices.void_credit")!;
    expect(definition.tier).toBe("full");
    // Before the decision this was true at Manage (the finance write route guard); now it is not.
    expect(canUseOpsPath(resolveOpsLevels(uniform("manage"), "m"), "/api/admin/invoices/one", "PATCH")).toBe(true);
    expect(evaluateCapability(uniform("manage"), ops, "invoices.void_credit")).toBe(false);
    const fullFinance = opsPolicySchema.parse({ ...EMPTY_OPS_POLICY, assignments: { m: { presetId: "existing", overrides: { ...allOpsLevels("manage"), finance: "full" } } } });
    expect(evaluateCapability(fullFinance, ops, "invoices.void_credit")).toBe(true);
    const granted = opsPolicySchema.parse({ ...EMPTY_OPS_POLICY, assignments: { m: { presetId: "existing", overrides: allOpsLevels("manage"), sensitive: { "invoices.void_credit": true } } } });
    expect(evaluateCapability(granted, ops, "invoices.void_credit")).toBe(true);
    const withheld = opsPolicySchema.parse({ ...EMPTY_OPS_POLICY, assignments: { m: { presetId: "existing", overrides: { ...allOpsLevels("manage"), finance: "full" }, sensitive: { "invoices.void_credit": false } } } });
    expect(evaluateCapability(withheld, ops, "invoices.void_credit")).toBe(false);
    expect(evaluateCapability(uniform("manage"), { id: "a", role: "ADMIN", heldRoles: ["ADMIN"] }, "invoices.void_credit")).toBe(true);
  });

  it("Full routes exactly like Manage everywhere a route guard looks", () => {
    const full = opsPolicySchema.parse({ ...EMPTY_OPS_POLICY, assignments: { m: { presetId: "existing", overrides: Object.fromEntries(OPS_FEATURE_KEYS.map((key) => [key, "full"])) } } });
    expect(resolveOpsLevels(full, "m")).toEqual(allOpsLevels("manage"));
  });

  it("capabilityFromParts is the only rule (sanity: no capability is on with every area Off)", () => {
    for (const capability of CAPABILITIES) {
      expect(capabilityFromParts(capability.key, { ...allOpsLevels("off") }, {}, {})).toBe(false);
    }
  });
});
