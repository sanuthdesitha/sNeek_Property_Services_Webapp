// @vitest-environment node
/** The rail seed is resolved like /api/me/ops-permissions, and never during "test as". */
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user } } }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.access }));
import { opsNavigationSeed } from "@/lib/rbac/ops-navigation-seed";

beforeEach(() => { vi.resetAllMocks(); m.access.mockResolvedValue(null); });

it("resolves the signed-in person's levels from their held roles", async () => {
  m.user.mockResolvedValue({ id: "ops", isActive: true, role: "OPS_MANAGER", extraRoles: [{ role: "CLEANER" }] });
  expect(await opsNavigationSeed({ userId: "ops", impersonating: false, retainedContext: false })).toEqual({ userId: "ops", role: "OPS_MANAGER", levels: null });
  expect(m.access).toHaveBeenCalledWith({ id: "ops", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER", "CLEANER"] });
});

it.each([
  [{ userId: null, impersonating: false, retainedContext: false }],
  [{ userId: "admin", impersonating: true, retainedContext: false }],
  [{ userId: "admin", impersonating: false, retainedContext: true }],
])("gives no seed for %j", async (input) => {
  expect(await opsNavigationSeed(input)).toBeNull();
  expect(m.user).not.toHaveBeenCalled();
});

it("gives no seed for an inactive account or a failed read", async () => {
  m.user.mockResolvedValueOnce({ id: "x", isActive: false, role: "ADMIN", extraRoles: [] });
  expect(await opsNavigationSeed({ userId: "x", impersonating: false, retainedContext: false })).toBeNull();
  m.user.mockRejectedValueOnce(new Error("db down"));
  expect(await opsNavigationSeed({ userId: "x", impersonating: false, retainedContext: false })).toBeNull();
});
