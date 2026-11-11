// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type UserRow = { id: string; email: string; role: string; isActive: boolean; clientId: string | null; emailVerified: Date | null; hourlyRate: number | null };

const m = vi.hoisted(() => {
  const users = new Map<string, UserRow>();
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const next = { ...users.get(where.id)!, ...data };
        users.set(where.id, next);
        return next;
      }),
      count: vi.fn(async ({ where }: { where: { role: string; isActive: boolean; id: { not: string } } }) =>
        Array.from(users.values()).filter((u) => u.role === where.role && u.isActive === where.isActive && u.id !== where.id.not).length,
      ),
    },
    session: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return { users, tx, requireRole: vi.fn(), issueSignupOtp: vi.fn() };
});
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/auth/registration-otp", () => ({ issueSignupOtp: m.issueSignupOtp }));
vi.mock("@/lib/db", () => ({ db: { ...m.tx, $transaction: async (fn: (tx: typeof m.tx) => unknown) => fn(m.tx) } }));

import { POST } from "@/app/api/admin/users/bulk/route";
import { LAST_ADMIN_MESSAGE } from "@/lib/accounts/account-status";

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/users/bulk", { method: "POST", body: JSON.stringify(body) }));
const user = (id: string, overrides: Partial<UserRow> = {}): UserRow => ({ id, email: `${id}@x`, role: "CLEANER", isActive: true, clientId: null, emailVerified: new Date(), hourlyRate: 30, ...overrides });

beforeEach(() => {
  vi.clearAllMocks();
  m.users.clear();
  for (const row of [user("me", { role: "ADMIN" }), user("c1"), user("c2", { isActive: false }), user("inv", { emailVerified: null })]) m.users.set(row.id, row);
  m.requireRole.mockResolvedValue({ user: { id: "me", role: "ADMIN", heldRoles: ["ADMIN"] } });
  m.issueSignupOtp.mockResolvedValue({ ok: true });
});

describe("POST /api/admin/users/bulk", () => {
  it("disables each person through the single-account service and answers per person", async () => {
    const res = await post({ action: "disable", ids: ["c1", "c2", "me", "ghost"] });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results).toEqual([
      { id: "c1", outcome: "done", message: "Disabled." },
      { id: "c2", outcome: "unchanged", message: "Already disabled." },
      { id: "me", outcome: "refused", message: "You cannot disable your own account." },
      { id: "ghost", outcome: "refused", message: "User not found." },
    ]);
    expect(m.users.get("c1")?.isActive).toBe(false);
    expect(m.tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "c1" } });
  });

  it("refuses to disable the last active admin", async () => {
    m.users.set("a2", user("a2", { role: "ADMIN" }));
    m.users.set("me", user("me", { role: "ADMIN", isActive: false })); // the actor's own row raced to disabled
    const { results } = await (await post({ action: "disable", ids: ["a2"] })).json();
    expect(results).toEqual([{ id: "a2", outcome: "refused", message: LAST_ADMIN_MESSAGE }]);
    expect(m.users.get("a2")?.isActive).toBe(true);
    expect(m.tx.$executeRaw).toHaveBeenCalled();
  });

  it("changes rates with the same bounds and audit as one person", async () => {
    const { results } = await (await post({ action: "change-rate", ids: ["c1", "c2"], hourlyRate: 35 })).json();
    expect(results.map((r: { outcome: string }) => r.outcome)).toEqual(["done", "done"]);
    expect(m.tx.auditLog.create).toHaveBeenCalledTimes(2);
    expect((await post({ action: "change-rate", ids: ["c1"], hourlyRate: 9000 })).status).toBe(400);
    expect((await post({ action: "change-rate", ids: ["c1"] })).status).toBe(400);
  });

  it("refuses disable and change-rate for an operations manager, but lets them resend invites", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } });
    expect((await post({ action: "disable", ids: ["c1"] })).status).toBe(403);
    expect((await post({ action: "change-rate", ids: ["c1"], hourlyRate: 35 })).status).toBe(403);
    const res = await post({ action: "resend-invite", ids: ["inv", "c1"] });
    const { results } = await res.json();
    expect(results).toEqual([
      { id: "inv", outcome: "done", message: "Invite sent." },
      { id: "c1", outcome: "refused", message: "User is already verified." },
    ]);
    expect(m.users.get("c1")?.isActive).toBe(true);
  });

  it("caps the selection size", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `u${i}`);
    expect((await post({ action: "resend-invite", ids })).status).toBe(400);
  });
});
