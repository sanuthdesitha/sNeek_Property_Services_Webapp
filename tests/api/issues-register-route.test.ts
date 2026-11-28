// @vitest-environment node
/** All issues register routes: live role, pilot, packs per source, impersonation, inputs. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";

const m = vi.hoisted(() => ({ role: vi.fn(), pilot: vi.fn(), ops: vi.fn(), read: vi.fn(), log: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/pilots/state", () => ({ isPilotOn: m.pilot }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/quality/register/load", () => ({ readRegister: m.read, REGISTER_SOURCE_CAP: 2000 }));
vi.mock("@/lib/quality/register/log-issue", async () => {
  class RegisterLogError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { RegisterLogError, logRegisterIssue: m.log };
});

import { GET, POST } from "@/app/api/admin/quality/register/route";
import { GET as exportCsv } from "@/app/api/admin/quality/register/export/route";

const req = (method: string, query = "", body?: unknown) =>
  new NextRequest(`http://local/api/admin/quality/register${query}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

const qaRow = {
  key: "QA_INSPECTION:i1", source: "QA_INSPECTION", recordId: "i1", date: "2026-11-27T00:00:00Z", title: "Mirror", detail: null,
  propertyId: "p1", propertyName: "Harbour", clientId: "c1", clientName: "Acme", cleaners: [{ id: "u1", name: "Ana" }], jobId: null, jobNumber: null,
  category: "bathroom", categoryLabel: "Bathroom", severity: "HIGH", severityLabel: "Major", open: true, statusLabel: "Pending", closedAt: null, closedBy: null, href: "/x",
};

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN } });
  m.pilot.mockResolvedValue(true);
  m.ops.mockResolvedValue(null);
  m.read.mockResolvedValue({
    rows: [qaRow],
    sources: [
      { source: "QA_INSPECTION", state: "ok", read: 1, truncated: false },
      { source: "DAMAGE", state: "failed", read: null, truncated: false },
    ],
  });
  m.log.mockResolvedValue({ caseId: "case-1", duplicate: false });
});

describe("GET", () => {
  it("live role guard: refused roles never read", async () => {
    m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await GET(req("GET"))).status).toBe(403);
    expect(m.role).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(m.read).not.toHaveBeenCalled();
  });

  it("pilot off for this person: 409 PILOT_OFF and nothing read", async () => {
    m.pilot.mockResolvedValue(false);
    const response = await GET(req("GET"));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PILOT_OFF");
    expect(m.pilot).toHaveBeenCalledWith("issues-register", { userId: "admin-1" });
    expect(m.read).not.toHaveBeenCalled();
  });

  it("a failed source is reported, never counted as zero", async () => {
    const body = await (await GET(req("GET", "?period=30d"))).json();
    expect(body.total).toBe(1);
    expect(body.sources).toEqual(expect.arrayContaining([expect.objectContaining({ source: "DAMAGE", state: "failed", read: null })]));
    expect(body.rows[0]).toMatchObject({ key: "QA_INSPECTION:i1", overdue: false });
  });

  it("ADMIN reads every source regardless of packs; an ops manager only their packs' sources", async () => {
    await GET(req("GET"));
    expect(m.read.mock.calls[0][0].allowed.size).toBe(8);
    m.role.mockResolvedValue({ user: { id: "ops-1", role: Role.OPS_MANAGER } });
    m.ops.mockResolvedValue({ ...allOpsLevels("off"), quality: "read", maintenance: "read" });
    await GET(req("GET"));
    expect(Array.from(m.read.mock.calls[1][0].allowed).sort()).toEqual(["MAINTENANCE", "QA_INSPECTION"]);
  });

  it("refuses an unknown filter or sort (400) rather than ignoring it", async () => {
    expect((await GET(req("GET", "?status=late"))).status).toBe(400);
    expect((await GET(req("GET", "?sort=cost"))).status).toBe(400);
  });

  it("CSV names the sources that could not load", async () => {
    const response = await exportCsv(req("GET", "?period=30d"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Could not load: Damage");
    expect(text).toContain("Harbour");
  });
});

describe("POST (log an issue)", () => {
  it("refused while testing as someone and with read-only packs, before anything is written", async () => {
    m.role.mockResolvedValueOnce({ user: { id: "admin-1", role: Role.ADMIN }, impersonation: { actorId: "admin-1" } });
    expect((await POST(req("POST", "", {}))).status).toBe(403);
    m.role.mockResolvedValue({ user: { id: "ops-1", role: Role.OPS_MANAGER } });
    m.ops.mockResolvedValue({ ...allOpsLevels("off"), quality: "manage", cases: "read" });
    expect((await POST(req("POST", "", {}))).status).toBe(403);
    expect(m.log).not.toHaveBeenCalled();
  });

  it("pilot off: 409 and nothing logged", async () => {
    m.pilot.mockResolvedValue(false);
    expect((await POST(req("POST", "", {}))).status).toBe(409);
    expect(m.log).not.toHaveBeenCalled();
  });

  it("logs as the actual actor; a replay answers 200", async () => {
    m.role.mockResolvedValue({ user: { id: "ops-1", role: Role.OPS_MANAGER } });
    m.ops.mockResolvedValue({ ...allOpsLevels("off"), quality: "manage", cases: "manage" });
    const response = await POST(req("POST", "", { kind: "OFFICE" }));
    expect(response.status).toBe(201);
    expect(m.log).toHaveBeenCalledWith({ id: "ops-1", role: Role.OPS_MANAGER }, { kind: "OFFICE" });
    m.log.mockResolvedValue({ caseId: "case-1", duplicate: true });
    expect((await POST(req("POST", "", { kind: "OFFICE" }))).status).toBe(200);
  });
});
