// @vitest-environment node
/** Property reminder rules API (item 9, slice B): ADMIN only to change, OPS_MANAGER views, impersonation refused, preview contract. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({ role: vi.fn(), save: vi.fn(), preview: vi.fn(), state: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: async () => [] } } }));
vi.mock("@/lib/pilots/state", async () => {
  const registry = await vi.importActual<typeof import("@/lib/pilots/registry")>("@/lib/pilots/registry");
  return { loadPilotState: async () => registry.parsePilotState(null) };
});
vi.mock("@/lib/properties/reminders/rules-load", async () => {
  const rules = await vi.importActual<typeof import("@/lib/properties/reminders/rules")>("@/lib/properties/reminders/rules");
  class RuleChangeError extends Error {
    constructor(public status: number, message: string, public code: string, public preview?: unknown) {
      super(message);
    }
  }
  return { loadRuleState: async () => rules.parseRuleState(null), previewRule: m.preview, saveRule: m.save, RuleChangeError };
});

import { GET, PATCH } from "@/app/api/admin/settings/reminder-rules/route";
import { RuleChangeError } from "@/lib/properties/reminders/rules-load";

const patch = (body: unknown) => PATCH(new NextRequest("http://localhost/api/admin/settings/reminder-rules", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  m.preview.mockImplementation(async (rule: string) => ({ rule, reminders: 2, properties: 1, cleaners: 0, examples: [] }));
  m.save.mockResolvedValue({ enabled: true, changedAt: "2026-11-28T00:00:00.000Z", changedById: "admin-1" });
});

describe("GET", () => {
  it("ADMIN or OPS_MANAGER (pack inside requireRole); ops view only; every rule off by default with its preview", async () => {
    m.role.mockResolvedValue({ user: { id: "ops-1", role: Role.OPS_MANAGER } });
    const response = await GET();
    expect(m.role).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await response.json();
    expect(body.canEdit).toBe(false);
    expect(body.rules.every((rule: { enabled: boolean }) => rule.enabled === false)).toBe(true);
    expect(body.rules[0].preview.summary).toBe("Would currently create 2 reminders at 1 property");
  });

  it("a failing preview is said, never zero", async () => {
    m.role.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN } });
    m.preview.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = await (await GET()).json();
    expect(body.canEdit).toBe(true);
    expect(body.rules[0].preview).toEqual({ failed: true });
  });
});

describe("PATCH", () => {
  it("asks requireRole for ADMIN only: an operations manager is refused", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await patch({ rule: "issue-room", enabled: true, seen: { reminders: 2, properties: 1, cleaners: 0 } })).status).toBe(403);
    expect(m.role).toHaveBeenCalledWith([Role.ADMIN]);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("refused while testing as another person", async () => {
    m.role.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN }, impersonation: { actorId: "admin-1", mode: "FULL", startedAt: 1 } });
    expect((await patch({ rule: "issue-room", enabled: false })).status).toBe(403);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("saves with the actual actor and the preview seen; a changed preview comes back as 409 with the new numbers", async () => {
    m.role.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN } });
    expect((await patch({ rule: "issue-room", enabled: true, seen: { reminders: 2, properties: 1, cleaners: 0 } })).status).toBe(200);
    expect(m.save).toHaveBeenCalledWith({ id: "admin-1", role: Role.ADMIN }, { rule: "issue-room", enabled: true, seen: { reminders: 2, properties: 1, cleaners: 0 } });
    m.save.mockRejectedValueOnce(new RuleChangeError(409, "The preview changed.", "PREVIEW_CHANGED", { rule: "issue-room", reminders: 3, properties: 2, cleaners: 0, examples: [] }));
    const conflict = await patch({ rule: "issue-room", enabled: true, seen: { reminders: 2, properties: 1, cleaners: 0 } });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).preview.summary).toBe("Would currently create 3 reminders at 2 properties");
    expect((await patch({ rule: "made-up", enabled: true })).status).toBe(400);
  });
});
