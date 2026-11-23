// @vitest-environment node
/**
 * POST /api/admin/cleaner-invoices/[id]/amend: the live role guard, the actual
 * person passed on (never the tested-as subject), and readable refusals.
 */
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: null as unknown, amend: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async (roles: string[]) => {
    const session = m.session as { user: { role: string } } | null;
    if (!session) throw new Error("UNAUTHORIZED");
    if (!roles.includes(session.user.role)) throw new Error("FORBIDDEN");
    return session;
  }),
}));
vi.mock("@/lib/cleaner/invoice-amend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cleaner/invoice-amend")>();
  return { ...actual, amendCleanerInvoice: m.amend };
});
vi.mock("@/lib/db", () => ({ db: {} }));
import { POST } from "@/app/api/admin/cleaner-invoices/[id]/amend/route";

const body = { requestKey: "key-12345678", expectedUpdatedAt: "2026-11-16T01:00:00.000Z", expectedRevision: 0, reason: "Parking was personal.", lines: [{ sourceIndex: 0, description: "Job", quantity: 1, unitAmount: 100 }] };
const call = (payload: unknown = body) => POST(new Request("http://localhost/amend", { method: "POST", body: JSON.stringify(payload) }) as never, { params: { id: "inv" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.amend.mockResolvedValue({ ok: true, status: 200, replayed: false, revision: 1, beforeTotal: 132, afterTotal: 100, changes: [], needsXeroUpdate: false, notice: null });
});

it("refuses a cleaner, and anyone signed out", async () => {
  m.session = { user: { id: "c", role: "CLEANER" } };
  expect((await call()).status).toBe(403);
  m.session = null;
  expect((await call()).status).toBe(401);
  expect(m.amend).not.toHaveBeenCalled();
});

it("passes the actual person and the impersonation to the service", async () => {
  m.session = { user: { id: "ops-subject", role: "OPS_MANAGER" }, impersonation: { actorId: "real-admin" } };
  expect((await call()).status).toBe(200);
  expect(m.amend.mock.calls[0][0].actor).toEqual({ userId: "real-admin", role: "OPS_MANAGER", impersonating: true });
  m.session = { user: { id: "admin", role: "ADMIN" } };
  await call();
  expect(m.amend.mock.calls[1][0].actor).toEqual({ userId: "admin", role: "ADMIN", impersonating: false });
});

it("answers a missing reason and a service refusal with their words", async () => {
  m.session = { user: { id: "admin", role: "ADMIN" } };
  const missing = await call({ ...body, reason: "" });
  expect(missing.status).toBe(400);
  expect((await missing.json()).error).toContain("Say why");
  m.amend.mockResolvedValueOnce({ ok: false, status: 409, reason: "This invoice is paid, so it cannot be edited." });
  const refused = await call();
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toContain("paid");
});
