// @vitest-environment node
/** Reminder suggestions API (item 9, slice C): live roles, packs via requireRole, impersonation refused, role recorded. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({ role: vi.fn(), list: vi.fn(), decide: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/properties/reminders/suggestions", () => {
  class SuggestionError extends Error {
    constructor(public status: number, message: string, public code: string) {
      super(message);
    }
  }
  return { listSuggestions: m.list, decideSuggestions: m.decide, SuggestionError };
});

import { GET, POST } from "@/app/api/admin/properties/reminder-suggestions/route";
import { SuggestionError } from "@/lib/properties/reminders/suggestions";

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/properties/reminder-suggestions", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  m.list.mockResolvedValue({ suggestions: [], previews: [], canAlways: true, rulesReadable: true });
  m.decide.mockResolvedValue([{ id: "s1", outcome: "APPROVED" }]);
});

describe("reminder suggestions routes", () => {
  it("ADMIN or OPS_MANAGER on every call; 401/403 from the live guard", async () => {
    m.role.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await GET()).status).toBe(401);
    m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await post({ action: "dismiss", ids: ["s1"] })).status).toBe(403);
    expect(m.role.mock.calls.every(([roles]) => JSON.stringify(roles) === JSON.stringify([Role.ADMIN, Role.OPS_MANAGER]))).toBe(true);
    expect(m.decide).not.toHaveBeenCalled();
  });

  it("an operations manager decides as OPS_MANAGER; ADMIN as ADMIN", async () => {
    m.role.mockResolvedValueOnce({ user: { id: "ops-1", role: Role.OPS_MANAGER } });
    expect((await post({ action: "approve", ids: ["s1"] })).status).toBe(200);
    m.role.mockResolvedValueOnce({ user: { id: "admin-1", role: Role.ADMIN } });
    await post({ action: "dismiss", ids: ["s1"] });
    expect(m.decide.mock.calls.map(([actor]) => actor)).toEqual([{ id: "ops-1", role: Role.OPS_MANAGER }, { id: "admin-1", role: Role.ADMIN }]);
  });

  it("refused while testing as someone; the queue then offers no decisions", async () => {
    const session = { user: { id: "admin-1", role: Role.ADMIN }, impersonation: { actorId: "admin-1", mode: "FULL", startedAt: 1 } };
    m.role.mockResolvedValue(session);
    expect((await post({ action: "approve", ids: ["s1"] })).status).toBe(403);
    expect(m.decide).not.toHaveBeenCalled();
    const body = await (await GET()).json();
    expect(body).toMatchObject({ canDecide: false, canAlways: false });
  });

  it("passes service refusals and bad bodies", async () => {
    m.role.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN } });
    m.decide.mockRejectedValueOnce(new SuggestionError(400, "Edit one suggestion at a time.", "EDIT_ONE"));
    expect((await post({ action: "approve", ids: ["a", "b"], edit: { text: "x", jobsCount: 1, mustConfirm: false } })).status).toBe(400);
    expect((await POST(new NextRequest("http://localhost/x", { method: "POST", body: "{" }))).status).toBe(400);
  });
});
