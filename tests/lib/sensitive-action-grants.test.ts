import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EMPTY_OPS_POLICY,
  opsPolicySchema,
  resolveSensitiveGrants,
} from "@/lib/rbac/ops-policy";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  profile: vi.fn(),
  policy: vi.fn(),
  compare: vi.fn(),
}));
// Own PINs live on UserSecurityPin (2026-11-13); `profile` now stands for that row.
vi.mock("@/lib/db", () => ({ db: {
  user: { findUnique: mocks.user },
  userSecurityPin: { findUnique: mocks.profile, upsert: async () => ({ failedAttempts: 1 }), update: async () => ({}), updateMany: async () => ({ count: 0 }) },
  auditLog: { create: async () => ({}) },
} }));
vi.mock("@/lib/security/actual-actor", () => ({ actualActorRefusal: async () => null }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsPolicy: mocks.policy }));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare } }));
import { verifySensitiveAction } from "@/lib/security/admin-verification";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({
    role: "OPS_MANAGER",
    isActive: true,
    passwordHash: "password-hash",
    extraRoles: [],
  });
  mocks.profile.mockResolvedValue({ userId: "manager", pinHash: "personal-pin-hash", pinSetAt: null, failedAttempts: 0, lockedUntil: null, resetAt: null });
  mocks.policy.mockResolvedValue(EMPTY_OPS_POLICY);
  mocks.compare.mockResolvedValue(true);
});
describe("explicit sensitive grants", () => {
  it("never grants destructive actions through the backwards-compatible Manage default", async () => {
    await expect(
      verifySensitiveAction("manager", { pin: "1234" }, "jobs.delete"),
    ).rejects.toThrow("FORBIDDEN");
    expect(mocks.compare).not.toHaveBeenCalled();
  });
  it("inherits grants from a pack and respects an explicit per-manager denial", () => {
    const policy = opsPolicySchema.parse({
      ...EMPTY_OPS_POLICY,
      presets: [
        {
          id: "custom-lead",
          name: "Lead",
          description: "",
          levels: { jobs: "manage" },
          sensitive: { "jobs.delete": true, "jobs.reset": true },
        },
      ],
      assignments: {
        manager: {
          presetId: "custom-lead",
          overrides: {},
          sensitive: { "jobs.delete": false },
        },
      },
    });
    expect(resolveSensitiveGrants(policy, "manager")).toEqual({
      "jobs.delete": false,
      "jobs.reset": true,
    });
    expect(resolveSensitiveGrants(policy, "someone-else")).toEqual({});
  });
  it("checks the granted manager's own PIN and still rejects a wrong PIN", async () => {
    mocks.policy.mockResolvedValue({
      ...EMPTY_OPS_POLICY,
      assignments: {
        manager: {
          presetId: "existing",
          overrides: {},
          sensitive: { "jobs.delete": true },
        },
      },
    });
    await expect(
      verifySensitiveAction("manager", { pin: "1234" }, "jobs.delete"),
    ).resolves.toBe(true);
    expect(mocks.compare).toHaveBeenCalledWith("1234", "personal-pin-hash");
    mocks.compare.mockResolvedValue(false);
    await expect(
      verifySensitiveAction("manager", { pin: "9999" }, "jobs.delete"),
    ).rejects.toThrow("INVALID_SECURITY_VERIFICATION");
  });
  it("rejects invented action grants", () => {
    expect(
      opsPolicySchema.safeParse({
        ...EMPTY_OPS_POLICY,
        assignments: {
          manager: {
            presetId: "existing",
            overrides: {},
            sensitive: { "security.owner": true },
          },
        },
      }).success,
    ).toBe(false);
  });
});
