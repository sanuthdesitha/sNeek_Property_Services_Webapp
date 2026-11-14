// @vitest-environment node
/**
 * Onboarding workspace routes use the live role guard, as the existing
 * onboarding routes do: ADMIN and OPS_MANAGER work onboarding (read, save,
 * activate, client links); the empty-draft review is ADMIN only. A refused
 * guard answers 401/403 and nothing else runs. Links are not sent while
 * testing as someone else. Every route is under the "onboarding" ops pack.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  save: vi.fn(),
  view: vi.fn(),
  activate: vi.fn(),
  createLink: vi.fn(),
  revoke: vi.fn(),
  board: vi.fn(),
  emptyDrafts: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/onboarding/workspace/service", () => ({
  OnboardingWorkspaceError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
  saveWorkspaceSection: m.save,
  loadWorkspaceView: m.view,
  listOnboardingBoard: m.board,
  listEmptyDrafts: m.emptyDrafts,
  emptyDraftWhere: () => ({}),
  overridesHoldAnswers: () => false,
  reviewClientCode: vi.fn(),
  revealAccessCode: vi.fn(),
}));
vi.mock("@/lib/onboarding/workspace/activate", () => ({ activateOnboarding: m.activate }));
vi.mock("@/lib/onboarding/workspace/client-link", () => ({ createClientLink: m.createLink, revokeClientLink: m.revoke }));

import { GET as getWorkspace, PATCH as patchWorkspace } from "@/app/api/admin/onboarding/surveys/[id]/workspace/route";
import { POST as activate } from "@/app/api/admin/onboarding/surveys/[id]/activate/route";
import { POST as createLink } from "@/app/api/admin/onboarding/surveys/[id]/client-links/route";
import { GET as board } from "@/app/api/admin/onboarding/board/route";
import { GET as emptyDrafts } from "@/app/api/admin/onboarding/empty-drafts/route";
import { opsRequestFeature } from "@/lib/rbac/ops-catalog";

const params = { params: { id: "survey-1" } };
const json = (url: string, method: string, body: unknown) => new NextRequest(url, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockImplementation(async (roles: string[]) => {
    if (!roles.includes("OPS_MANAGER") && !roles.includes("ADMIN")) throw new Error("FORBIDDEN");
    return { user: { id: "u1", role: "ADMIN" } };
  });
  m.save.mockResolvedValue({ revision: 1 });
  m.view.mockResolvedValue({ id: "survey-1" });
  m.activate.mockResolvedValue({ ok: true });
  m.createLink.mockResolvedValue({ linkId: "l1" });
  m.board.mockResolvedValue({ rows: [], counts: {}, timezone: "Australia/Sydney" });
  m.emptyDrafts.mockResolvedValue([]);
});

describe("onboarding workspace authorization", () => {
  it("lets ADMIN and OPS_MANAGER read, save, activate and send links (same as the existing onboarding routes)", async () => {
    await getWorkspace(new NextRequest("http://localhost/x"), params);
    await patchWorkspace(json("http://localhost/x", "PATCH", { section: "basics", values: { propertyName: "A" }, baseRevision: 0 }), params);
    await activate(json("http://localhost/x", "POST", { createInitialJobs: false, baseRevision: 0 }), params);
    await createLink(json("http://localhost/x", "POST", { sections: ["access"], transport: "EMAIL", recipient: "a@example.invalid", days: 7, idempotencyKey: "key-12345678" }), params);
    await board(new NextRequest("http://localhost/api/admin/onboarding/board?tab=open"));
    for (const call of m.role.mock.calls) expect(call[0]).toEqual(["ADMIN", "OPS_MANAGER"]);
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ actor: { source: "ADMIN_CREATED", userId: "u1", clientLinkId: null } }));
    expect(m.activate).toHaveBeenCalledWith({ surveyId: "survey-1", actorUserId: "u1", createInitialJobs: false, baseRevision: 0 });
  });

  it("keeps the empty-draft review ADMIN only", async () => {
    await emptyDrafts();
    expect(m.role).toHaveBeenCalledWith(["ADMIN"]);
  });

  it("answers a refused guard with 403 and runs nothing", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    const responses = await Promise.all([
      patchWorkspace(json("http://localhost/x", "PATCH", { section: "basics", values: {}, baseRevision: 0 }), params),
      activate(json("http://localhost/x", "POST", { createInitialJobs: false, baseRevision: 0 }), params),
      emptyDrafts(),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expect(m.save).not.toHaveBeenCalled();
    expect(m.activate).not.toHaveBeenCalled();
    m.role.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await getWorkspace(new NextRequest("http://localhost/x"), params)).status).toBe(401);
  });

  it("does not send a client link while testing as someone else", async () => {
    m.role.mockResolvedValue({ user: { id: "u1", role: "OPS_MANAGER" }, impersonation: { actorId: "admin" } });
    const response = await createLink(json("http://localhost/x", "POST", { sections: ["access"], transport: "EMAIL", recipient: "a@example.invalid", days: 7, idempotencyKey: "key-12345678" }), params);
    expect(response.status).toBe(403);
    expect(m.createLink).not.toHaveBeenCalled();
  });

  it("refuses a request without an explicit transport or with an unknown section", async () => {
    expect((await createLink(json("http://localhost/x", "POST", { sections: ["access"], recipient: "a@example.invalid", days: 7, idempotencyKey: "key-12345678" }), params)).status).toBe(400);
    expect((await createLink(json("http://localhost/x", "POST", { sections: ["pricing"], transport: "EMAIL", recipient: "a@example.invalid", days: 7, idempotencyKey: "key-12345678" }), params)).status).toBe(400);
    expect(m.createLink).not.toHaveBeenCalled();
  });

  it("maps every new admin route to the onboarding pack", () => {
    for (const path of ["/api/admin/onboarding/board", "/api/admin/onboarding/surveys/x/workspace", "/api/admin/onboarding/surveys/x/activate", "/api/admin/onboarding/surveys/x/client-links", "/api/admin/onboarding/empty-drafts", "/v2/admin/onboarding/OB-1"]) {
      expect(opsRequestFeature(path), path).toBe("onboarding");
    }
  });
});
