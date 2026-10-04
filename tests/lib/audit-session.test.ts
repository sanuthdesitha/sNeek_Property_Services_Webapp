// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), cookie: vi.fn(), impersonate: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: m.session }));
vi.mock("@/lib/auth/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user } } }));
vi.mock("@/lib/auth/active-role", () => ({ readActiveRoleCookie: m.cookie }));
vi.mock("@/lib/auth/impersonation-server", () => ({ resolveImpersonation: m.impersonate }));
import { requireRole, requireRealSession, requireSession } from "@/lib/auth/session";
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: "person", role: "ADMIN" } }); m.user.mockResolvedValue({ id: "person", isActive: true, role: "CLEANER", extraRoles: [] }); });
it.each([requireSession, requireRealSession])("rejects inactive users despite valid JWT", async fn => {
  m.user.mockResolvedValue({ isActive: false }); await expect(fn()).rejects.toThrow("UNAUTHORIZED");
});
it("live demotion overrides admin JWT and old active-role cookie", async () => {
  m.cookie.mockReturnValue("ADMIN"); await expect(requireRole(["ADMIN"])).rejects.toThrow("FORBIDDEN");
});
it("preserves held-role admission but replaces revoked grants", async () => {
  m.user.mockResolvedValue({ id: "person", isActive: true, role: "CLEANER", extraRoles: [{ role: "QA_INSPECTOR" }] });
  expect((await requireRole(["QA_INSPECTOR"])).user.heldRoles).toEqual(["CLEANER", "QA_INSPECTOR"]);
  m.user.mockResolvedValue({ id: "person", isActive: true, role: "CLEANER", extraRoles: [] });
  await expect(requireRole(["QA_INSPECTOR"])).rejects.toThrow("FORBIDDEN");
});
it("real identity check ignores impersonation and reloads live primary role", async () => {
  expect((await requireRealSession()).user).toMatchObject({ id: "person", role: "CLEANER" }); expect(m.impersonate).not.toHaveBeenCalled();
});
it("impersonation replaces admin grants instead of retaining them", async () => {
  m.user.mockResolvedValue({ id: "person", isActive: true, role: "ADMIN", extraRoles: [] });
  m.impersonate.mockResolvedValue({ target: { id: "target", role: "CLEANER" }, actor: { id: "person" }, mode: "READ_ONLY", ticket: { startedAt: 1 } });
  await expect(requireRole(["ADMIN"])).rejects.toThrow("FORBIDDEN");
});
it.each([requireSession, requireRealSession])("rejects an absent session before database access", async fn => {
  m.session.mockResolvedValue(null);
  await expect(fn()).rejects.toThrow("UNAUTHORIZED");
  expect(m.user).not.toHaveBeenCalled();
});
it.each([requireSession, requireRealSession])("rejects a deleted account despite a valid JWT", async fn => {
  m.user.mockResolvedValue(null);
  await expect(fn()).rejects.toThrow("UNAUTHORIZED");
  expect(m.impersonate).not.toHaveBeenCalled();
});
