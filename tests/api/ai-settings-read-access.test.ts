// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; heldRoles?: string[] }; impersonation?: unknown },
  credentials: vi.fn(), saveRouting: vi.fn(), routing: vi.fn(), resolve: vi.fn(), usage: vi.fn(), facts: vi.fn(), lastSave: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requireRole: async (roles: string[]) => {
    if (!m.session) throw new Error("UNAUTHORIZED");
    const held = m.session.user.heldRoles ?? [m.session.user.role];
    if (!held.some((role) => roles.includes(role))) throw new Error("FORBIDDEN");
    return m.session;
  },
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/ai/provider/admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider/admin")>("@/lib/ai/provider/admin");
  return { AiSettingsConflict: actual.AiSettingsConflict, saveAiRouting: m.saveRouting, getPublicCredentialStates: m.credentials };
});
vi.mock("@/lib/ai/provider/routing", () => ({ getAiRouting: m.routing, resolveFeatureRoute: m.resolve }));
vi.mock("@/lib/ai/provider/usage", () => ({ getMonthlyAiUsage: m.usage }));
vi.mock("@/lib/ai/provider/status", () => ({ getAiStatusFacts: m.facts, lastAiSettingsSave: m.lastSave }));

import { GET, PUT } from "@/app/api/admin/ai/settings/route";
import { AiSettingsConflict } from "@/lib/ai/provider/admin";
import { DEFAULT_AI_ROUTING } from "@/lib/ai/provider/routing-schema";

const facts = { lastTests: { wording: { status: "SUCCEEDED", at: "2026-11-14T00:00:00.000Z", ok: true, message: "ok", provider: "anthropic", model: "m", durationMs: 1, detail: null } }, providers: {}, limitHits: {}, lastSaved: { at: "2026-11-14T00:00:00.000Z", by: "Hannah Lee" }, ollama: null };
const put = (body: unknown) => new Request("http://local/api", { method: "PUT", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  m.session = { user: { id: "admin-1", role: "ADMIN" } };
  m.credentials.mockResolvedValue([{ provider: "anthropic", state: "saved", hint: "••••a9F2" }]);
  m.routing.mockResolvedValue(DEFAULT_AI_ROUTING);
  m.usage.mockResolvedValue(null);
  m.facts.mockResolvedValue(facts);
  m.resolve.mockImplementation(async (feature: string) => ({ feature, provider: "ollama", model: "gemma3:4b", configured: true, enabled: true, cloud: false, allowImages: true, source: "photo-settings" }));
});

describe("GET /api/admin/ai/settings read access", () => {
  it("gives administrators the key's last four, the recorded facts and edit rights", async () => {
    const body = await (await GET()).json();
    expect(body.credentials[0].hint).toBe("••••a9F2");
    expect(body.status.lastTests.wording.ok).toBe(true);
    expect(body.status.lastSaved.by).toBe("Hannah Lee");
    expect(body).toMatchObject({ canEdit: true, isAdmin: true });
  });

  it("lets an operations manager read everything except any part of a key, without edit rights", async () => {
    m.session = { user: { id: "ops-1", role: "OPS_MANAGER" } };
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.credentials[0]).toEqual({ provider: "anthropic", state: "saved", hint: null });
    expect(JSON.stringify(body)).not.toContain("a9F2");
    expect(body).toMatchObject({ canEdit: false, isAdmin: false });
    expect(body.routes).toHaveLength(8);
  });

  it("an administrator testing as someone reads without edit rights; other roles are refused", async () => {
    m.session = { user: { id: "admin-1", role: "ADMIN" }, impersonation: { actorId: "admin-1" } };
    expect((await (await GET()).json()).canEdit).toBe(false);
    m.session = { user: { id: "c-1", role: "CLEANER" } };
    expect((await GET()).status).toBe(403);
  });

  it("says the facts are not known (null) when they cannot be read, never empty", async () => {
    m.facts.mockRejectedValue(new Error("db down"));
    const body = await (await GET()).json();
    expect(body.status).toBeNull();
  });
});

describe("PUT /api/admin/ai/settings", () => {
  it("refuses operations managers (administrators only change AI settings)", async () => {
    m.session = { user: { id: "ops-1", role: "OPS_MANAGER" } };
    expect((await PUT(put({ expectedRevision: 0, settings: {} }))).status).toBe(403);
    expect(m.saveRouting).not.toHaveBeenCalled();
  });

  it("names who saved first on a stale save", async () => {
    m.saveRouting.mockRejectedValue(new AiSettingsConflict({ ...DEFAULT_AI_ROUTING, revision: 4 }));
    m.lastSave.mockResolvedValue({ at: "2026-11-14T09:20:00.000Z", by: "Hannah Lee" });
    const response = await PUT(put({ expectedRevision: 3, settings: {} }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.current.revision).toBe(4);
    expect(body.savedBy).toEqual({ at: "2026-11-14T09:20:00.000Z", by: "Hannah Lee" });
  });
});
