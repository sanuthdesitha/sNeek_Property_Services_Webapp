import { describe, expect, it } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { allOpsLevels, canUseOpsPath, opsRequestFeature } from "@/lib/rbac/ops-catalog";
import { opsPolicySchema, resolveOpsLevels, isOpsSubject, EMPTY_OPS_POLICY } from "@/lib/rbac/ops-policy";

describe("operations feature policy", () => {
  it("preserves current ops authority for unassigned managers without granting admin features", () => {
    const levels = resolveOpsLevels(EMPTY_OPS_POLICY, "user");
    expect(canUseOpsPath(levels, "/api/admin/jobs", "POST")).toBe(true);
    expect(canUseOpsPath(levels, "/api/admin/ops-permissions", "PUT")).toBe(false);
    expect(canUseOpsPath(levels, "/api/admin/users/user/roles", "PATCH")).toBe(false);
  });
  it("resolves per-manager packs and overrides, with omitted custom features off", () => {
    const policy = opsPolicySchema.parse({ revision: 2, presets: [{ id: "custom-team", name: "Team", description: "", levels: { jobs: "read" } }], assignments: { a: { presetId: "custom-team", overrides: { jobs: "manage" } }, b: { presetId: "custom-team", overrides: {} } } });
    expect(resolveOpsLevels(policy, "a").jobs).toBe("manage");
    expect(resolveOpsLevels(policy, "b").jobs).toBe("read");
    expect(resolveOpsLevels(policy, "b").finance).toBe("off");
  });
  it.each(["GET", "HEAD", "OPTIONS"])("permits safe %s requests for view-only jobs", (method) => expect(canUseOpsPath(allOpsLevels("read"), "/api/admin/jobs/job", method)).toBe(true));
  it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks %s for view-only jobs", (method) => expect(canUseOpsPath(allOpsLevels("read"), "/api/admin/jobs/job", method)).toBe(false));
  it("maps all existing admin route roots, failing closed for new unmapped areas", () => {
    for (const root of ["app/api/admin", "app/admin", "app/v2/admin"]) {
      for (const name of readdirSync(root)) if (existsSync(`${root}/${name}/page.tsx`) || existsSync(`${root}/${name}/route.ts`) || !name.includes(".")) {
        expect(opsRequestFeature(`/${root.replace(/^app\//, "")}/${name}`), `${root}/${name}`).not.toBe("unmapped");
      }
    }
    expect(canUseOpsPath(allOpsLevels("manage"), "/api/admin/future-feature")).toBe(false);
  });
  it("handles retained/classic/Estate aliases and cannot spoof settings ownership with a query", () => {
    expect(opsRequestFeature(`/_accounts/${"a".repeat(32)}/v2/admin/settings?tab=laundry`)).toBe("laundry-settings");
    expect(opsRequestFeature("/api/admin/settings?tab=laundry")).toBe("settings");
    expect(opsRequestFeature("/api/admin/phase4/shopping-runs/one/optimize")).toBe("inventory");
    expect(opsRequestFeature("/api/chat/channels")).toBe("communications");
  });
  it("rejects invalid levels, features, preset references and duplicate IDs", () => {
    for (const overrides of [{ jobs: "true" }, { secret: "manage" }]) expect(opsPolicySchema.safeParse({ ...EMPTY_OPS_POLICY, assignments: { user: { presetId: "existing", overrides } } }).success).toBe(false);
    expect(opsPolicySchema.safeParse({ ...EMPTY_OPS_POLICY, assignments: { user: { presetId: "missing", overrides: {} } } }).success).toBe(false);
    const preset = { id: "custom-a", name: "A", description: "", levels: {} };
    expect(opsPolicySchema.safeParse({ ...EMPTY_OPS_POLICY, presets: [preset, preset] }).success).toBe(false);
  });
  it("never derives authority from a switched active role or from an impersonating admin", () => {
    expect(isOpsSubject({ role: "CLEANER", heldRoles: ["OPS_MANAGER", "CLEANER"] })).toBe(true);
    expect(isOpsSubject({ role: "OPS_MANAGER", heldRoles: ["ADMIN", "OPS_MANAGER"] })).toBe(false);
    expect(isOpsSubject({ role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] })).toBe(true);
  });
});

it("keeps permitted settings reachable when the overview is off", async () => {
  const { opsNavigationHref } = await import("@/lib/rbac/ops-catalog");
  const levels = { ...allOpsLevels("off"), "property-form": "manage" as const };
  expect(opsNavigationHref(levels, "/v2/admin/settings")).toBe("/v2/admin/settings?tab=property-form");
  expect(opsNavigationHref(allOpsLevels("off"), "/v2/admin/settings")).toBeNull();
});

it("blocks worker endpoint aliases and media previews when their workspace is off", () => {
  const levels = { ...allOpsLevels("manage"), jobs: "off" as const, inventory: "read" as const };
  expect(canUseOpsPath(levels, "/api/cleaner/jobs/job/submit", "POST")).toBe(false);
  expect(canUseOpsPath(levels, "/api/cleaner/inventory/held-stock", "POST")).toBe(false);
  expect(canUseOpsPath(levels, "/api/uploads/access?key=jobs%2Fjob%2Fphoto.jpg")).toBe(false);
  expect(canUseOpsPath({ ...levels, files: "off" }, "/api/uploads/access?key=uploads%2Fself%2Fphoto.jpg")).toBe(false);
});
