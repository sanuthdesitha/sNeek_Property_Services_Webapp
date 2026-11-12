// @vitest-environment node
/**
 * Owner decision 2026-11-12: password and two-step resets can be granted to a
 * non-administrator; the routes enforce the guardrails on the server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = { id: string; role: string; isActive: boolean; extraRoles: Array<{ role: string }>; email?: string; name?: string; twoFactorEnabled?: boolean };
const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  verify: vi.fn(),
  policy: vi.fn(),
  rows: new Map<string, Row>(),
  update: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: m.verify }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsPolicy: m.policy }));
vi.mock("@/lib/notifications/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })), sendEmailDetailed: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/auth/account-state", () => ({ upsertAuthUserState: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({}) }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: () => ({ subject: "s", html: "h" }) }));
vi.mock("@/lib/db", () => {
  const tx = { user: { update: m.update }, session: { deleteMany: vi.fn() }, trustedDevice: { deleteMany: vi.fn() } };
  return {
    db: {
      user: { findUnique: async ({ where }: { where: { id: string } }) => m.rows.get(where.id) ?? null, update: m.update },
      trustedDevice: { deleteMany: vi.fn() },
      auditLog: { create: m.audit },
      $transaction: async (work: unknown) => (typeof work === "function" ? (work as (client: typeof tx) => unknown)(tx) : Promise.all(work as unknown[])),
    },
  };
});
import { POST as RESET_PASSWORD } from "@/app/api/admin/users/[id]/reset-password/route";
import { POST as RESET_2FA } from "@/app/api/admin/users/[id]/disable-2fa/route";

const request = () => new NextRequest("http://localhost/api/admin/users/x/reset-password", { method: "POST", body: JSON.stringify({ security: { pin: "1234" } }) });
const grantee = { user: { id: "ops", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };
const grantPolicy = {
  revision: 1,
  presets: [],
  assignments: {
    ops: { presetId: "coordinator", overrides: {}, capabilities: { "accounts.reset_password": true } },
    peer: { presetId: "existing", overrides: {} },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.policy.mockResolvedValue(grantPolicy);
  m.verify.mockResolvedValue(true);
  m.requireRole.mockResolvedValue(grantee);
  m.rows.clear();
  m.rows.set("ops", { id: "ops", role: "OPS_MANAGER", isActive: true, extraRoles: [] });
  m.rows.set("admin", { id: "admin", role: "ADMIN", isActive: true, extraRoles: [], email: "a@x", name: "A" });
  m.rows.set("peer", { id: "peer", role: "OPS_MANAGER", isActive: true, extraRoles: [], email: "p@x", name: "P" });
  m.rows.set("cleaner", { id: "cleaner", role: "CLEANER", isActive: true, extraRoles: [], email: "c@x", name: "C", twoFactorEnabled: true });
});

describe("delegated password reset", () => {
  it("lets a grantee reset a cleaner's password after their PIN, audited with the actual actor and role", async () => {
    const response = await RESET_PASSWORD(request(), { params: { id: "cleaner" } });
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("ops", { pin: "1234" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "ops", action: "RESET_USER_PASSWORD", after: expect.objectContaining({ actorRole: "OPS_MANAGER" }) }) }));
  });
  it("refuses an administrator target, someone with more access, and their own account", async () => {
    for (const id of ["admin", "peer", "ops"]) {
      expect((await RESET_PASSWORD(request(), { params: { id } })).status, id).toBe(403);
    }
    expect(m.update).not.toHaveBeenCalled();
  });
  it("refuses while testing as someone", async () => {
    m.requireRole.mockResolvedValue({ ...grantee, impersonation: { actorId: "admin" } });
    expect((await RESET_PASSWORD(request(), { params: { id: "cleaner" } })).status).toBe(403);
  });
  it("refuses a manager without the grant (the default)", async () => {
    m.policy.mockResolvedValue({ revision: 0, presets: [], assignments: {} });
    expect((await RESET_PASSWORD(request(), { params: { id: "cleaner" } })).status).toBe(403);
    expect((await RESET_2FA(request(), { params: { id: "cleaner" } })).status).toBe(403);
    expect(m.verify).not.toHaveBeenCalled();
  });
  it("two-step reset needs its own grant", async () => {
    expect((await RESET_2FA(request(), { params: { id: "cleaner" } })).status).toBe(403);
  });
});
