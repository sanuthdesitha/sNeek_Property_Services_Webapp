// @vitest-environment node
/**
 * POST /api/admin/access-requests ("Ask an administrator…", board "Access
 * denied"): live guard, never while testing as someone, only office staff
 * whose live access really leaves the area out, same-origin only, and the
 * page they came from is named only when it belongs to that area. It never
 * writes the access policy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";

const m = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), request: vi.fn(), savePolicy: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.access, saveOpsPolicy: m.savePolicy }));
vi.mock("@/lib/access/access-request", () => ({ requestAreaAccess: m.request }));
import { POST } from "@/app/api/admin/access-requests/route";

const manager = { user: { id: "chloe", name: "Chloe Martin", email: "c@x", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };

function post(body: unknown, origin = "http://localhost") {
  return POST(new NextRequest("http://localhost/api/admin/access-requests", { method: "POST", headers: { origin, host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue(manager);
  m.access.mockResolvedValue({ ...allOpsLevels("manage"), finance: "off" });
  m.request.mockResolvedValue({ ok: true, outcome: { state: "sent", askedAtLabel: "10:12 am", recipients: 2, inInbox: 2, queued: 0 } });
});

describe("Ask an administrator", () => {
  it("sends for an area the live access refuses, naming the page only when it belongs to that area", async () => {
    const response = await post({ area: "finance", from: "/v2/admin/finance/invoices" });
    expect(response.status).toBe(200);
    expect((await response.json()).outcome.state).toBe("sent");
    expect(m.request).toHaveBeenCalledWith(expect.objectContaining({ area: "finance", fromPage: "Invoices and pay", fromPath: "/v2/admin/finance/invoices" }));
    await post({ area: "finance", from: "/v2/admin/jobs" });
    expect(m.request).toHaveBeenLastCalledWith(expect.objectContaining({ fromPage: null, fromPath: null }));
    await post({ area: "finance", from: "https://evil.example/v2/admin/finance" });
    expect(m.request).toHaveBeenLastCalledWith(expect.objectContaining({ fromPage: null }));
  });

  it("grants nothing: the access policy is never written", async () => {
    await post({ area: "finance" });
    expect(m.savePolicy).not.toHaveBeenCalled();
  });

  it("refuses while testing as someone (it would go out in their name)", async () => {
    m.session.mockResolvedValue({ ...manager, impersonation: { actorId: "admin", mode: "FULL", startedAt: 1 } });
    expect((await post({ area: "finance" })).status).toBe(403);
    expect(m.request).not.toHaveBeenCalled();
  });

  it.each([
    [{ user: { id: "a", role: "ADMIN", heldRoles: ["ADMIN"] } }],
    [{ user: { id: "a", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER", "ADMIN"] } }],
    [{ user: { id: "c", role: "CLEANER", heldRoles: ["CLEANER"] } }],
  ])("refuses people who are not office staff with a pack (%#)", async (session) => {
    m.session.mockResolvedValue(session);
    expect((await post({ area: "finance" })).status).toBe(403);
    expect(m.request).not.toHaveBeenCalled();
  });

  it("refuses an area they already have, an unknown area, and a cross-site request", async () => {
    expect((await post({ area: "jobs" })).status).toBe(409);
    expect((await post({ area: "owner" })).status).toBe(400);
    expect((await post({ area: "finance" }, "https://evil.example")).status).toBe(403);
    expect(m.request).not.toHaveBeenCalled();
  });

  it("says access could not be checked when the policy read fails, and sends nothing", async () => {
    m.access.mockRejectedValue(new Error("corrupt"));
    const response = await post({ area: "finance" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("could not be checked");
    expect(m.request).not.toHaveBeenCalled();
  });

  it("answers 401 when the live session is gone", async () => {
    m.session.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await post({ area: "finance" })).status).toBe(401);
  });
});
