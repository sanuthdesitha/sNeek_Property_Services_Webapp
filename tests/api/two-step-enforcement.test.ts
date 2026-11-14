// @vitest-environment node
/**
 * Two-step sign-in requirement for administrators (owner default 2026-11-16,
 * pending owner confirmation) as enforced by the live session guard, and the
 * "signed out everywhere else" refusal in the NextAuth session callback.
 *  - the first admin page starts the grace period; nothing is refused during it;
 *  - after it, admin pages redirect to Your profile's two-step card, the
 *    profile page itself stays open (no lock-out), API routes are never refused
 *    here (2FA setup, sign-out and recovery keep working);
 *  - operations managers are never redirected (suggested only);
 *  - a revoked sign-in reads as signed out on the next server read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), updateMany: vi.fn(), path: vi.fn(), redirect: vi.fn(), impersonate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: m.session }));
vi.mock("@/lib/auth/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user, updateMany: m.updateMany } } }));
vi.mock("@/lib/auth/active-role", () => ({ readActiveRoleCookie: () => null }));
vi.mock("@/lib/auth/impersonation-server", () => ({ resolveImpersonation: m.impersonate }));
vi.mock("@/lib/auth/last-seen", () => ({ recordLastSeen: vi.fn() }));
vi.mock("@/lib/rbac/ops-access", () => ({ enforceOpsRequest: vi.fn() }));
vi.mock("next/headers", () => ({ headers: () => ({ get: () => m.path() }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    m.redirect(to);
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { requireRole } from "@/lib/auth/session";

const DAY = 86_400_000;
const adminUser = (overrides: Record<string, unknown> = {}) => ({ id: "admin2", isActive: true, role: "ADMIN", extraRoles: [], twoFactorEnabled: false, twoStepRequiredSince: null, ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "admin2", role: "ADMIN" } });
  m.updateMany.mockResolvedValue({ count: 1 });
  m.impersonate.mockResolvedValue(null);
});

describe("requirement on admin pages", () => {
  it("starts the grace period on the first admin page and lets the administrator through", async () => {
    m.user.mockResolvedValue(adminUser());
    m.path.mockReturnValue("/v2/admin/jobs");
    await expect(requireRole(["ADMIN", "OPS_MANAGER"] as never)).resolves.toBeTruthy();
    expect(m.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "admin2", twoStepRequiredSince: null }, data: { twoStepRequiredSince: expect.any(Date) } });
    expect(m.redirect).not.toHaveBeenCalled();
  });

  it("during the grace period nothing is refused", async () => {
    m.user.mockResolvedValue(adminUser({ twoStepRequiredSince: new Date(Date.now() - 5 * DAY) }));
    m.path.mockReturnValue("/v2/admin/finance");
    await expect(requireRole(["ADMIN"] as never)).resolves.toBeTruthy();
    expect(m.redirect).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("after the grace period an admin page goes to the two-step card", async () => {
    m.user.mockResolvedValue(adminUser({ twoStepRequiredSince: new Date(Date.now() - 15 * DAY) }));
    m.path.mockReturnValue("/v2/admin/jobs");
    await expect(requireRole(["ADMIN"] as never)).rejects.toThrow("NEXT_REDIRECT:/v2/admin/profile?setup=two-step");
  });

  it("never locks anyone out: Your profile and every API route stay open", async () => {
    m.user.mockResolvedValue(adminUser({ twoStepRequiredSince: new Date(Date.now() - 30 * DAY) }));
    for (const path of ["/v2/admin/profile", "/v2/admin/profile?setup=two-step", "/api/auth/2fa/settings", "/api/admin/users/x/disable-2fa"]) {
      m.path.mockReturnValue(path);
      await expect(requireRole(["ADMIN"] as never)).resolves.toBeTruthy();
    }
    expect(m.redirect).not.toHaveBeenCalled();
  });

  it("does nothing once two-step is on, and never redirects an operations manager", async () => {
    m.path.mockReturnValue("/v2/admin/jobs");
    m.user.mockResolvedValue(adminUser({ twoFactorEnabled: true, twoStepRequiredSince: new Date(0) }));
    await expect(requireRole(["ADMIN"] as never)).resolves.toBeTruthy();
    m.session.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER" } });
    m.user.mockResolvedValue({ id: "ops", isActive: true, role: "OPS_MANAGER", extraRoles: [], twoFactorEnabled: false, twoStepRequiredSince: null });
    await expect(requireRole(["OPS_MANAGER"] as never)).resolves.toBeTruthy();
    expect(m.redirect).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("a signed-out token on a page goes to sign-in; on an API it is 401", async () => {
    m.session.mockResolvedValue(null);
    m.path.mockReturnValue("/v2/admin/jobs");
    await expect(requireRole(["ADMIN"] as never)).rejects.toThrow("NEXT_REDIRECT:/login");
    m.path.mockReturnValue("/api/admin/jobs");
    await expect(requireRole(["ADMIN"] as never)).rejects.toThrow("UNAUTHORIZED");
  });
});
