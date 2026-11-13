// @vitest-environment node
/**
 * Scheduling-rules routes and the generic settings guard: who may view, that
 * an unavailable store is a 503 (never an empty success), that edits refuse
 * without an editor, and that the generic settings PATCH reports (and does not
 * apply) changes to rule-owned fields.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  session: { user: { id: "ops", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } } as any,
  requireRole: vi.fn(),
  book: vi.fn(),
  view: vi.fn(),
  canEdit: vi.fn(),
  viewed: vi.fn(),
  publish: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireRole: (...args: unknown[]) => m.requireRole(...args) }));
vi.mock("@/lib/rbac/ops-access", async () => {
  const { EMPTY_OPS_POLICY } = await import("@/lib/rbac/ops-policy");
  return { getOpsPolicy: async () => EMPTY_OPS_POLICY };
});
vi.mock("@/lib/db", () => ({ db: { auditLog: { create: (...args: unknown[]) => m.audit(...args) } } }));
vi.mock("@/lib/scheduling-rules/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/scheduling-rules/store")>();
  return { ...original, loadSchedulingRuleBook: (...args: unknown[]) => m.book(...args) };
});
vi.mock("@/lib/scheduling-rules/view", () => ({ buildSchedulingRulesView: (...args: unknown[]) => m.view(...args) }));
vi.mock("@/lib/scheduling-rules/service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/scheduling-rules/service")>();
  return { ...original, canEditRules: (...args: unknown[]) => m.canEdit(...args), recordRulesViewed: (...args: unknown[]) => m.viewed(...args), publishRules: (...args: unknown[]) => m.publish(...args) };
});
vi.mock("@/lib/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/settings")>();
  return { ...original, getAppSettings: (...args: unknown[]) => m.getSettings(...args), saveAppSettings: (...args: unknown[]) => m.saveSettings(...args) };
});

import { GET } from "@/app/api/admin/settings/scheduling-rules/route";
import { POST as publish } from "@/app/api/admin/settings/scheduling-rules/publish/route";
import { POST as unlock } from "@/app/api/admin/settings/scheduling-rules/unlock/route";
import { PATCH as patchSettings } from "@/app/api/admin/settings/route";
import { SchedulingRulesUnavailableError } from "@/lib/scheduling-rules/store";
import { RulesEditError } from "@/lib/scheduling-rules/service";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { allOpsLevels, canUseOpsPath } from "@/lib/rbac/ops-catalog";

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(m.session);
  m.book.mockResolvedValue({ live: { version: 1 } });
  m.view.mockResolvedValue({ liveVersion: 1, rules: [] });
  m.canEdit.mockResolvedValue(false);
  m.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
  m.saveSettings.mockImplementation(async () => DEFAULT_SETTINGS);
});

describe("viewing", () => {
  it("admits ADMIN and OPS_MANAGER, records the view and never caches", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect(m.viewed).toHaveBeenCalledWith("ops");
    expect(m.view).toHaveBeenCalledWith(expect.anything(), { canEdit: false });
  });

  it("an unavailable store is a 503 with its reason, not an empty list", async () => {
    m.book.mockRejectedValue(new SchedulingRulesUnavailableError("version 1 failed its checksum."));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "SCHEDULING_RULES_UNAVAILABLE", reason: "version 1 failed its checksum." });
    expect(m.viewed).not.toHaveBeenCalled();
  });

  it("is refused for other roles", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await GET()).status).toBe(403);
  });

  it("is a Settings-area route for a manager pack (view yes, write needs Manage)", () => {
    const read = { ...allOpsLevels("off"), settings: "read" as const };
    expect(canUseOpsPath(read, "/api/admin/settings/scheduling-rules", "GET")).toBe(true);
    expect(canUseOpsPath(read, "/api/admin/settings/scheduling-rules/publish", "POST")).toBe(false);
    expect(canUseOpsPath(read, "/admin/settings/scheduling-rules", "GET")).toBe(true);
    expect(canUseOpsPath(allOpsLevels("off"), "/api/admin/settings/scheduling-rules", "GET")).toBe(false);
  });
});

describe("changing", () => {
  it("unlock refuses a manager without the grant (403) before any PIN check", async () => {
    const res = await unlock(new NextRequest("http://localhost/api/admin/settings/scheduling-rules/unlock", { method: "POST", body: JSON.stringify({ pin: "1234" }) }));
    expect(res.status).toBe(403);
  });

  it("publish passes the locked-flow refusals through with their status", async () => {
    m.publish.mockRejectedValueOnce(new RulesEditError(409, "STALE", "The rules changed since you opened them."));
    const body = { token: "t", credentials: { pin: "1" }, values: {}, effectiveFrom: "2026-11-21", reason: "Because of the owner", expectedLatestVersion: 1, appliesToExisting: false, confirmed: true, kind: "EDIT" };
    const res = await publish(new NextRequest("http://localhost/api/admin/settings/scheduling-rules/publish", { method: "POST", body: JSON.stringify(body) }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "STALE" });
    const malformed = await publish(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ ...body, extra: true }) }));
    expect(malformed.status).toBe(400);
  });
});

describe("the generic settings PATCH", () => {
  it("reports rule-owned changes it did not apply and saves the rest", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    const res = await patchSettings(new NextRequest("http://localhost/api/admin/settings", { method: "PATCH", body: JSON.stringify({ companyName: "New name", laundryOperations: { maxOutdoorDays: 9 } }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Scheduling-Rules-Ignored")).toBe("laundryOperations.maxOutdoorDays");
    expect(await res.json()).toMatchObject({ schedulingRulesIgnored: ["laundryOperations.maxOutdoorDays"] });
    expect(m.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ companyName: "New name" }));
  });
});
