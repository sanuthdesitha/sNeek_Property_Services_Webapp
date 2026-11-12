// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { EMPTY_OPS_POLICY, type OpsPolicy } from "@/lib/rbac/ops-policy";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  policy: vi.fn(),
  save: vi.fn(),
  verify: vi.fn(),
  users: new Map<string, { id: string; role: string; isActive: boolean; extraRoles: Array<{ role: string }> }>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsPolicy: m.policy, saveOpsPolicy: m.save, getOpsGrants: async () => [] }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: m.verify }));
vi.mock("@/lib/rbac/access-directory", () => ({ loadAccessScreen: async (viewer: unknown) => ({ viewer }) }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: async ({ where }: { where: { id: string } }) => m.users.get(where.id) ?? null } } }));
import { GET, PUT } from "@/app/api/admin/ops-permissions/route";

const admin = { user: { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"] } };
const editor = { user: { id: "editor", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };
const stored: OpsPolicy = {
  ...EMPTY_OPS_POLICY,
  revision: 4,
  assignments: {
    editor: { presetId: "coordinator", overrides: {}, capabilities: { "access.edit_permissions": true } },
    low: { presetId: "observer", overrides: {} },
  },
};
const put = (body: unknown) => new NextRequest("https://example.invalid/api/admin/ops-permissions", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const withLow = (overrides: Record<string, string>, extra: Partial<OpsPolicy["assignments"][string]> = {}): OpsPolicy => ({
  ...stored,
  assignments: { ...stored.assignments, low: { presetId: "observer", overrides: overrides as never, ...extra } },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(admin);
  m.policy.mockResolvedValue(structuredClone(stored));
  m.save.mockImplementation(async (_actor: string, policy: OpsPolicy) => ({ ...policy, revision: policy.revision + 1 }));
  m.verify.mockResolvedValue(true);
  m.users.clear();
  m.users.set("low", { id: "low", role: "OPS_MANAGER", isActive: true, extraRoles: [] });
  m.users.set("editor", { id: "editor", role: "OPS_MANAGER", isActive: true, extraRoles: [] });
});

describe("PUT /api/admin/ops-permissions", () => {
  it("an administrator saves with their PIN; the save is audited by saveOpsPolicy with the real actor", async () => {
    const response = await PUT(put({ policy: withLow({ jobs: "manage" }), security: { pin: "1234" } }));
    expect(response.status).toBe(200);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect(m.verify).toHaveBeenCalledWith("admin", { pin: "1234" });
    expect(m.save).toHaveBeenCalledWith("admin", expect.objectContaining({ revision: 4 }), expect.objectContaining({ impersonatedBy: null }));
  });

  it("asks for the PIN: a missing or wrong one saves nothing (423)", async () => {
    m.verify.mockRejectedValueOnce(new Error("PIN_OR_PASSWORD_REQUIRED"));
    expect((await PUT(put({ policy: withLow({ jobs: "manage" }), security: {} }))).status).toBe(423);
    m.verify.mockRejectedValueOnce(new Error("INVALID_SECURITY_VERIFICATION"));
    expect((await PUT(put({ policy: withLow({ jobs: "manage" }), security: { pin: "0000" } }))).status).toBe(423);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("a stale revision returns 409 with the newer version and saves nothing", async () => {
    const response = await PUT(put({ policy: { ...withLow({ jobs: "manage" }), revision: 3 }, security: { pin: "1234" } }));
    expect(response.status).toBe(409);
    expect((await response.json()).current.revision).toBe(4);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("refuses while impersonating, even for an administrator", async () => {
    m.requireRole.mockResolvedValue({ ...editor, impersonation: { actorId: "admin" } });
    expect((await PUT(put({ policy: withLow({ jobs: "manage" }), security: { pin: "1234" } }))).status).toBe(403);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("refuses an operations manager without the grant", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "low", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } });
    expect((await PUT(put({ policy: withLow({ jobs: "manage" }), security: { pin: "1234" } }))).status).toBe(403);
    expect((await GET()).status).toBe(403);
  });

  it("a delegated editor may raise someone below them, within their own access, with their PIN", async () => {
    m.requireRole.mockResolvedValue(editor);
    expect((await PUT(put({ policy: withLow({ jobs: "manage" }), security: { pin: "1234" } }))).status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("editor", { pin: "1234" });
  });

  it("a delegated editor cannot self-elevate, exceed their own access, or hand out administrator capabilities", async () => {
    m.requireRole.mockResolvedValue(editor);
    const self: OpsPolicy = { ...stored, assignments: { ...stored.assignments, editor: { ...stored.assignments.editor, overrides: { finance: "manage" } } } };
    for (const [policy, code] of [
      [self, "SELF"],
      [withLow({ finance: "manage" }), "EXCEEDS_OWN_ACCESS"],
      [withLow({}, { capabilities: { "access.test_as": true } }), "ADMIN_CAPABILITIES"],
    ] as const) {
      const response = await PUT(put({ policy, security: { pin: "1234" } }));
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe(code);
    }
    expect(m.save).not.toHaveBeenCalled();
  });

  it("an administrator changing their own entry is refused by the store (403)", async () => {
    m.save.mockRejectedValueOnce(new Error("OPS_POLICY_SELF_CHANGE"));
    const response = await PUT(put({ policy: withLow({ jobs: "manage" }), security: { pin: "1234" } }));
    expect(response.status).toBe(403);
  });
});
