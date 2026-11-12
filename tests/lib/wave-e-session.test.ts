// @vitest-environment node
/** "Last seen" is recorded for the genuine signed-in person, never for an impersonated target. */
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), updateMany: vi.fn(), cookie: vi.fn(), impersonate: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: m.session }));
vi.mock("@/lib/auth/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user, updateMany: m.updateMany } } }));
vi.mock("@/lib/auth/active-role", () => ({ readActiveRoleCookie: m.cookie }));
vi.mock("@/lib/auth/impersonation-server", () => ({ resolveImpersonation: m.impersonate }));
vi.mock("@/lib/rbac/ops-access", () => ({ enforceOpsRequest: vi.fn() }));
import { requireSession } from "@/lib/auth/session";
import { resetLastSeenThrottle } from "@/lib/auth/last-seen";

beforeEach(() => {
  vi.clearAllMocks();
  resetLastSeenThrottle();
  m.updateMany.mockResolvedValue({ count: 1 });
  m.session.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  m.user.mockResolvedValue({ id: "admin-1", isActive: true, role: "ADMIN", extraRoles: [] });
});

it("records the actual actor while testing as someone else, and the session acts as the target", async () => {
  m.impersonate.mockResolvedValue({ target: { id: "cleaner-9", role: "CLEANER" }, actor: { id: "admin-1" }, mode: "READ_ONLY", ticket: { startedAt: 1 } });
  const session = await requireSession();
  expect(session.user.id).toBe("cleaner-9");
  expect(m.updateMany).toHaveBeenCalledTimes(1);
  expect(m.updateMany.mock.calls[0][0].where.id).toBe("admin-1");
  expect(JSON.stringify(m.updateMany.mock.calls)).not.toContain("cleaner-9");
});

it("does not write on every request", async () => {
  m.impersonate.mockResolvedValue(null);
  await requireSession();
  await requireSession();
  await requireSession();
  expect(m.updateMany).toHaveBeenCalledTimes(1);
});

it("never refuses the request when the write fails", async () => {
  m.impersonate.mockResolvedValue(null);
  m.updateMany.mockRejectedValue(new Error("db busy"));
  await expect(requireSession()).resolves.toMatchObject({ user: { id: "admin-1" } });
});
