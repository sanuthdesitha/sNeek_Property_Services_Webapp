// @vitest-environment node
/**
 * Owner decision 2026-11-13: "Move to team…" — administrators only (as the
 * Assistants screen's other team changes), a stale source team refused, the
 * refusal reasons passed through, and the pure access change the dialog shows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireRole: vi.fn(), user: vi.fn(), move: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user }, vaTeam: { findUnique: vi.fn() }, auditLog: { create: vi.fn() } } }));
vi.mock("@/lib/va/move-member", async () => {
  const rules = await import("@/lib/va/move-rules");
  class VaMoveRefused extends Error {
    constructor(readonly code: keyof typeof rules.MOVE_REFUSAL_TEXT) {
      super(rules.MOVE_REFUSAL_TEXT[code]);
    }
  }
  return { moveVaMember: m.move, VaMoveRefused };
});

import { PATCH } from "@/app/api/admin/va-teams/[id]/members/[userId]/route";
import { VaMoveRefused } from "@/lib/va/move-member";
import { moveAccessChange, moveRefusal, type MoveTeamFacts } from "@/lib/va/move-rules";
import { emptyVaPermissions } from "@/lib/va/permissions";

const patch = (body: unknown) => PATCH(new Request("https://app.invalid/x", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "team-a", userId: "va-1" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  m.user.mockResolvedValue({ vaTeamId: "team-a" });
  m.move.mockResolvedValue({ userId: "va-1", from: { id: "team-a", name: "A" }, to: { id: "team-b", name: "B" }, loses: [], gains: [], scope: null });
});

describe("PATCH move", () => {
  it("uses the administrator-only guard and records the actual actor", async () => {
    expect((await patch({ toTeamId: "team-b" })).status).toBe(200);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(m.move).toHaveBeenCalledWith({ userId: "va-1", toTeamId: "team-b", confirmInactive: false, actor: { id: "admin-1", role: "ADMIN", impersonatedBy: null } });
  });

  it("refuses an operations manager (the live guard says FORBIDDEN)", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await patch({ toTeamId: "team-b" })).status).toBe(403);
    expect(m.move).not.toHaveBeenCalled();
  });

  it("refuses a stale source team and an empty body", async () => {
    m.user.mockResolvedValue({ vaTeamId: "team-z" });
    expect((await patch({ toTeamId: "team-b" })).status).toBe(409);
    expect((await patch({})).status).toBe(400);
    expect(m.move).not.toHaveBeenCalled();
  });

  it("passes a refusal through with its reason", async () => {
    m.move.mockRejectedValue(new VaMoveRefused("CROSS_CLIENT"));
    const response = await patch({ toTeamId: "team-b", confirmInactive: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CROSS_CLIENT", error: expect.stringContaining("same client") });
  });
});

describe("move rules", () => {
  const team = (overrides: Partial<MoveTeamFacts>): MoveTeamFacts => ({ id: "a", name: "A", clientId: "c1", isActive: true, permissions: emptyVaPermissions(), propertyIds: null, ...overrides });

  it("states exactly what changes", () => {
    const from = team({ permissions: { ...emptyVaPermissions(), bookings: true, reports: true }, propertyIds: ["p1"] });
    const to = team({ id: "b", name: "B", permissions: { ...emptyVaPermissions(), reports: true, messages: true } });
    expect(moveAccessChange(from, to, new Map([["p1", "Harbour"]]))).toEqual({ loses: ["Bookings"], gains: ["Messages"], scope: "Properties: from Harbour to every property of the client." });
    expect(moveAccessChange(from, { ...from, id: "c" }, new Map()).scope).toBeNull();
    expect(moveAccessChange(from, { ...to, isActive: false }, new Map()).loses).toContain("Everything until the team is switched on");
  });

  it("refuses the same team, another client, and a switched-off team unless confirmed", () => {
    expect(moveRefusal(team({}), team({}), false)).toBe("SAME_TEAM");
    expect(moveRefusal(team({}), team({ id: "b", clientId: "c2" }), true)).toBe("CROSS_CLIENT");
    expect(moveRefusal(team({}), team({ id: "b", isActive: false }), false)).toBe("DESTINATION_INACTIVE");
    expect(moveRefusal(team({}), team({ id: "b", isActive: false }), true)).toBeNull();
  });
});
