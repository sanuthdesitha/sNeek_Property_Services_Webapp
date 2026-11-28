// @vitest-environment node
/**
 * Review note (2026-11-28): PATCH /api/admin/job-unused-checks/[id] enforces
 * the OPS_MANAGER Approvals pack with the LIVE in-route guard (requireRole →
 * requireSession → enforceOpsRequest re-reads the policy on this request),
 * not only middleware. ADMIN is not limited by packs. Only the session and
 * database are mocked here; the real guard runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  impersonation: vi.fn(),
  user: vi.fn(),
  policy: vi.fn(),
  answer: vi.fn(),
  role: "ADMIN",
}));
vi.mock("next-auth", () => ({ getServerSession: m.session }));
vi.mock("@/lib/auth/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/auth/active-role", () => ({ readActiveRoleCookie: () => m.role }));
vi.mock("@/lib/auth/impersonation-server", () => ({ resolveImpersonation: m.impersonation }));
vi.mock("next/headers", () => ({
  headers: () =>
    new Headers({
      "x-sneek-request-path": "/api/admin/job-unused-checks/check-1",
      "x-sneek-request-method": "PATCH",
    }),
}));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user }, appSetting: { findUnique: m.policy } } }));
vi.mock("@/lib/notifications/inline-dispatch", () => ({ deliverInboxIntentsNow: async () => new Map() }));
vi.mock("@/lib/jobs/unused-check", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jobs/unused-check")>("@/lib/jobs/unused-check");
  return { ...actual, answerUnusedCheck: m.answer };
});

import { PATCH } from "@/app/api/admin/job-unused-checks/[id]/route";

type OpsLevel = "off" | "read" | "manage";

function asPerson(role: "ADMIN" | "OPS_MANAGER") {
  m.role = role;
  m.session.mockResolvedValue({ user: { id: "person", role } });
  m.user.mockResolvedValue({ id: "person", role, isActive: true, extraRoles: [] });
}

function approvalsPack(level: OpsLevel) {
  m.policy.mockResolvedValue({
    value: { revision: 1, presets: [], assignments: { person: { presetId: "existing", overrides: { approvals: level } } } },
  });
}

const answer = () =>
  PATCH(
    new NextRequest("http://local/api/admin/job-unused-checks/check-1", { method: "PATCH", body: JSON.stringify({ decision: "CLEAN_AS_NORMAL" }) }),
    { params: { id: "check-1" } },
  );

beforeEach(() => {
  vi.resetAllMocks();
  m.impersonation.mockResolvedValue(null);
  m.answer.mockResolvedValue({ outcome: "ANSWERED", check: { id: "check-1", decision: "CLEAN_AS_NORMAL", decidedAt: new Date() }, intentIds: [] });
});

describe("answer route: live operations pack guard", () => {
  it("refuses an operations manager whose Approvals pack is off or read-only, before anything is written", async () => {
    asPerson("OPS_MANAGER");
    for (const level of ["off", "read"] as const) {
      approvalsPack(level);
      const response = await answer();
      expect(response.status, level).toBe(403);
    }
    expect(m.answer).not.toHaveBeenCalled();
    expect(m.policy).toHaveBeenCalled();
  });

  it("lets an operations manager with Approvals at manage answer", async () => {
    asPerson("OPS_MANAGER");
    approvalsPack("manage");
    expect((await answer()).status).toBe(200);
    expect(m.answer).toHaveBeenCalledWith({ id: "person", role: "OPS_MANAGER" }, "check-1", { decision: "CLEAN_AS_NORMAL" });
  });

  it("does not limit an administrator by packs (the policy is not even read)", async () => {
    asPerson("ADMIN");
    approvalsPack("off");
    expect((await answer()).status).toBe(200);
    expect(m.policy).not.toHaveBeenCalled();
  });

  it("an administrator testing as a restricted manager keeps the manager's restriction", async () => {
    asPerson("ADMIN");
    m.impersonation.mockResolvedValue({
      actor: { id: "person", name: "Owner", email: "o@example.invalid" },
      target: { id: "manager", role: "OPS_MANAGER", name: "M", email: "m@example.invalid" },
      mode: "FULL",
      ticket: { startedAt: 1 },
    });
    m.policy.mockResolvedValue({ value: { revision: 1, presets: [], assignments: { manager: { presetId: "existing", overrides: { approvals: "off" } } } } });
    expect((await answer()).status).toBe(403);
    expect(m.answer).not.toHaveBeenCalled();
  });
});
