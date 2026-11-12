// @vitest-environment node
/**
 * Owner decision 2026-11-13: who may use "Message team" on a job — the
 * office-send rule `job_team_message`: ADMIN; OPS_MANAGER with the Jobs pack
 * at manage (view only and other packs refused); nobody while impersonating.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireRole: vi.fn(), ops: vi.fn(), send: vi.fn(), preview: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops, getOpsPolicy: async () => ({ revision: 0, presets: [], assignments: {} }) }));
vi.mock("@/lib/notifications/job-office-message", () => ({ sendJobOfficeMessage: m.send, previewJobOfficeMessage: m.preview }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET, POST } from "@/app/api/admin/jobs/[id]/office-message/route";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";

const admin = { user: { id: "admin-1", role: "ADMIN", heldRoles: ["ADMIN"] } };
const manager = { user: { id: "ops-1", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };
const post = () => POST(new Request("https://app.invalid/api/admin/jobs/j1/office-message", { method: "POST", body: JSON.stringify({ body: "x" }) }), { params: { id: "j1" } });
const get = () => GET(new Request("https://app.invalid/api/admin/jobs/j1/office-message"), { params: { id: "j1" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(admin);
  m.ops.mockResolvedValue(allOpsLevels("manage"));
  m.send.mockResolvedValue({ outcomes: [], refused: [], transportsUsed: ["INBOX"], replayed: false });
  m.preview.mockResolvedValue({ recipients: [] });
});

describe("Message team rights", () => {
  it("an administrator sends as themselves, recorded with their role", async () => {
    expect((await post()).status).toBe(200);
    expect(m.send).toHaveBeenCalledWith({ id: "admin-1", role: "ADMIN" }, "j1", { body: "x" });
  });

  it("an operations manager with Jobs at manage may send; view only is refused", async () => {
    m.requireRole.mockResolvedValue(manager);
    expect((await post()).status).toBe(200);
    expect(m.send).toHaveBeenLastCalledWith({ id: "ops-1", role: "OPS_MANAGER" }, "j1", { body: "x" });
    m.ops.mockResolvedValue({ ...allOpsLevels("manage"), jobs: "read" });
    const refused = await post();
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toMatch(/Jobs/);
    expect((await get()).status).toBe(403);
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it("nobody while impersonating, administrators included", async () => {
    m.requireRole.mockResolvedValue({ ...admin, impersonation: { actorId: "admin-1" } });
    expect((await post()).status).toBe(403);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("a revoked account is refused by the live guard", async () => {
    m.requireRole.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await post()).status).toBe(401);
  });
});
