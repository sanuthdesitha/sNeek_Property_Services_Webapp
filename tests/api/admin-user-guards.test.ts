// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    user: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    session: { deleteMany: vi.fn() },
    trustedDevice: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    // Own PINs (2026-11-13): the acting administrator has a PIN, so a password alone is refused.
    userSecurityPin: {
      findUnique: vi.fn(async () => ({ userId: "a1", pinHash: "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234", pinSetAt: null, failedAttempts: 0, lockedUntil: null, resetAt: null })),
      upsert: vi.fn(async () => ({ failedAttempts: 1 })),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { tx, requireRole: vi.fn() };
});
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: { ...m.tx, $transaction: async (fn: unknown) => (typeof fn === "function" ? fn(m.tx) : Promise.all(fn as Promise<unknown>[])) } }));
vi.mock("@/lib/security/actual-actor", () => ({ actualActorRefusal: vi.fn(async () => null) }));
vi.mock("@/lib/accounts/user-details", () => ({ getUserExtendedProfile: vi.fn(async () => null), upsertUserExtendedProfile: vi.fn() }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsPolicy: vi.fn(async () => ({})), getOpsAccess: vi.fn(async () => null) }));
vi.mock("@/lib/clients/contact-sync", () => ({ normalizeClientEmail: (v: string) => v.toLowerCase(), syncClientContactFromPrimaryUser: vi.fn() }));
vi.mock("@/lib/workforce/service", () => ({ autoAssignCleanerLearning: vi.fn(), ensureDefaultLearningPaths: vi.fn() }));
vi.mock("@/lib/accounts/person-profile", () => ({ loadPersonProfile: vi.fn() }));
vi.mock("@/lib/notifications/email", () => ({ sendEmail: vi.fn(async () => ({ ok: true })), sendEmailDetailed: vi.fn(async () => ({ ok: true })) }));

import { DELETE, PATCH } from "@/app/api/admin/users/[id]/route";
import { POST as RESET_PASSWORD } from "@/app/api/admin/users/[id]/reset-password/route";
import { POST as RESET_2FA } from "@/app/api/admin/users/[id]/disable-2fa/route";
import { LAST_ADMIN_MESSAGE } from "@/lib/accounts/account-status";

const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/admin/users/a2", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = { params: { id: "a2" } };

beforeEach(() => {
  vi.clearAllMocks();
  // The routes now admit OPS_MANAGER to their guard (delegated administrator capabilities), so the administrator is explicit.
  m.requireRole.mockResolvedValue({ user: { id: "me", role: "ADMIN", heldRoles: ["ADMIN"] } });
  m.tx.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === "me"
      ? { id: "me", role: "ADMIN", isActive: true, passwordHash: null, extraRoles: [] }
      : { id: "a2", email: "a2@x", role: "ADMIN", isActive: true, clientId: null, twoFactorEnabled: true, name: "A2", _count: { jobAssignments: 0, timeLogs: 0, formSubmissions: 0, payAdjustmentRequests: 0, payAdjustmentReviews: 0 } },
  );
  m.tx.user.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "a2", role: "ADMIN", ...data }));
});

describe("the last active admin", () => {
  it("cannot be disabled through the account PATCH", async () => {
    m.tx.user.count.mockResolvedValue(0);
    const res = await PATCH(req("PATCH", { isActive: false }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(LAST_ADMIN_MESSAGE);
    expect(m.tx.user.update).not.toHaveBeenCalled();
  });

  it("cannot be demoted through the account PATCH", async () => {
    m.tx.user.count.mockResolvedValue(0);
    expect((await PATCH(req("PATCH", { role: "CLEANER" }), ctx)).status).toBe(400);
  });

  it("can be disabled when another active admin remains", async () => {
    m.tx.user.count.mockResolvedValue(1);
    const res = await PATCH(req("PATCH", { isActive: false }), ctx);
    expect(res.status).toBe(200);
    expect(m.tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "a2" } });
  });
});

describe("destructive actions still need a PIN or password on the server", () => {
  it("refuses reset password, reset 2FA and delete without one", async () => {
    for (const run of [() => RESET_PASSWORD(req("POST", {}), ctx), () => RESET_2FA(req("POST", {}), ctx), () => DELETE(req("DELETE", {}), ctx)]) {
      const res = await run();
      expect(res.status).toBe(423);
      expect((await res.json()).error).toBe("PIN_OR_PASSWORD_REQUIRED");
    }
    expect(m.tx.user.update).not.toHaveBeenCalled();
  });

  it("refuses a wrong PIN or password", async () => {
    const res = await RESET_2FA(req("POST", { security: { password: "nope" } }), ctx);
    expect(res.status).toBe(423);
  });
});
