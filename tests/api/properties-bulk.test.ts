// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    property: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    requireRole: vi.fn(),
    sync: vi.fn(),
    settings: { propertyFormTemplateOverrides: {} as Record<string, Record<string, string>> },
    saveSettings: vi.fn(),
    tx,
    db: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      user: { findMany: vi.fn() },
      property: { findMany: vi.fn() },
      formTemplate: { findMany: vi.fn() },
      integration: { findMany: vi.fn() },
      auditLog: { create: vi.fn() },
    },
  };
});
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/ical/sync", () => ({ syncPropertyIcal: m.sync }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => m.settings, saveAppSettings: m.saveSettings }));
vi.mock("@/lib/security/encryption", () => ({ decryptSecret: (value: string | null) => value, encryptSecret: (value: string) => `enc:${value}` }));

import { POST } from "@/app/api/admin/properties/bulk/route";
import { propertyBulkSchema } from "@/lib/properties/bulk-types";

const LAUNDRY = "clxlaundry000000000000001";
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/properties/bulk", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "office", role: "OPS_MANAGER" } });
  m.settings.propertyFormTemplateOverrides = {};
  m.saveSettings.mockImplementation(async (input: { propertyFormTemplateOverrides: Record<string, Record<string, string>> }) => ({ propertyFormTemplateOverrides: input.propertyFormTemplateOverrides }));
});

describe("POST /api/admin/properties/bulk — set laundry partner", () => {
  beforeEach(() => {
    m.db.user.findMany.mockResolvedValue([{ id: LAUNDRY, name: "Kevin", email: "k@x.invalid" }]);
    m.tx.property.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "off") return { isActive: true, laundryEnabled: false, accessInfo: {}, accessCode: null };
      if (where.id === "same") return { isActive: true, laundryEnabled: true, accessInfo: { laundryTeamUserIds: [LAUNDRY] }, accessCode: null };
      if (where.id === "legacy") return { isActive: true, laundryEnabled: true, accessInfo: { codes: "1234", lockbox: "Gate", attachments: [{ name: "a", url: "u" }] }, accessCode: null };
      return null;
    });
  });

  it("answers per property: done, unchanged, refused (laundry off, missing) — never done for a refused row", async () => {
    const response = await post({ action: "set-laundry-team", ids: ["legacy", "same", "off", "gone"], userIds: [LAUNDRY] });
    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results.map((r: { id: string; outcome: string }) => [r.id, r.outcome])).toEqual([["legacy", "done"], ["same", "unchanged"], ["off", "refused"], ["gone", "refused"]]);
    // Merged, not rebuilt: access text and files survive; the legacy code moves to the encrypted column.
    const update = m.tx.property.update.mock.calls[0][0];
    expect(update.data.accessInfo).toMatchObject({ lockbox: "Gate", laundryTeamUserIds: [LAUNDRY], attachments: [{ name: "a", url: "u" }] });
    expect(update.data.accessInfo.codes).toBeUndefined();
    expect(update.data.accessCode).toBe("enc:1234");
    expect(m.tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("refuses the whole request when an account is not an active laundry account", async () => {
    m.db.user.findMany.mockResolvedValue([]);
    const response = await post({ action: "set-laundry-team", ids: ["legacy"], userIds: [LAUNDRY] });
    expect(response.status).toBe(400);
    expect(m.tx.property.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/properties/bulk — assign checklist", () => {
  beforeEach(() => {
    m.db.formTemplate.findMany.mockResolvedValue([{ id: "tpl", serviceType: "AIRBNB_TURNOVER" }]);
    m.db.property.findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    m.settings.propertyFormTemplateOverrides = { p2: { AIRBNB_TURNOVER: "tpl", DEEP_CLEAN: "deep" }, p1: { DEEP_CLEAN: "keep" } };
  });

  it("sets the override for one job type, keeps the others, and reports unchanged and archived rows", async () => {
    const { results } = await (await post({ action: "assign-checklist", ids: ["p1", "p2", "p3"], jobType: "AIRBNB_TURNOVER", templateId: "tpl" })).json();
    expect(results.map((r: { outcome: string }) => r.outcome)).toEqual(["done", "unchanged", "refused"]);
    expect(m.saveSettings).toHaveBeenCalledTimes(1);
    expect(m.saveSettings.mock.calls[0][0].propertyFormTemplateOverrides.p1).toEqual({ DEEP_CLEAN: "keep", AIRBNB_TURNOVER: "tpl" });
    expect(m.db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("refuses a template of another job type or an inactive one", async () => {
    m.db.formTemplate.findMany.mockResolvedValue([{ id: "tpl", serviceType: "DEEP_CLEAN" }]);
    expect((await post({ action: "assign-checklist", ids: ["p1"], jobType: "AIRBNB_TURNOVER", templateId: "tpl" })).status).toBe(400);
    m.db.formTemplate.findMany.mockResolvedValue([]);
    expect((await post({ action: "assign-checklist", ids: ["p1"], jobType: "AIRBNB_TURNOVER", templateId: "tpl" })).status).toBe(400);
    expect(m.saveSettings).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/properties/bulk — sync calendars", () => {
  it("syncs linked calendars one by one and reports unlinked, running and failed ones honestly", async () => {
    m.db.integration.findMany.mockResolvedValue([
      { id: "i1", propertyId: "p1", isEnabled: true, icalUrl: "https://x.invalid/1.ics", syncStatus: "SUCCESS" },
      { id: "i2", propertyId: "p2", isEnabled: false, icalUrl: null, syncStatus: "IDLE" },
      { id: "i3", propertyId: "p3", isEnabled: true, icalUrl: "https://x.invalid/3.ics", syncStatus: "SYNCING" },
      { id: "i4", propertyId: "p4", isEnabled: true, icalUrl: "https://x.invalid/4.ics", syncStatus: "ERROR" },
    ]);
    m.sync.mockImplementation(async (id: string) => {
      if (id === "i4") throw new Error("Feed returned 404");
      return { runId: "r", summary: { reservationsCreated: 2, jobsCreated: 1, jobsUpdated: 0 } };
    });
    const { results } = await (await post({ action: "sync-calendars", ids: ["p1", "p2", "p3", "p4"] })).json();
    expect(results).toEqual([
      { id: "p1", outcome: "done", message: "2 reservations, 1 jobs created, 0 updated." },
      { id: "p2", outcome: "refused", message: "Calendar not linked." },
      { id: "p3", outcome: "refused", message: "A sync is already running." },
      { id: "p4", outcome: "failed", message: "Feed returned 404" },
    ]);
    expect(m.sync).toHaveBeenCalledWith("i1", { triggeredById: "office", mode: "MANUAL" });
  });

  it("caps a calendar sync at 20 properties", () => {
    const ids = Array.from({ length: 21 }, (_, index) => `p${index}`);
    expect(propertyBulkSchema.safeParse({ action: "sync-calendars", ids }).success).toBe(false);
    expect(propertyBulkSchema.safeParse({ action: "set-laundry-team", ids, userIds: [] }).success).toBe(true);
  });
});

describe("guards", () => {
  it("keeps the ADMIN / OPS_MANAGER guard and rejects a malformed body", async () => {
    m.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await post({ action: "sync-calendars", ids: ["p1"] })).status).toBe(403);
    expect((await post({ action: "delete-everything", ids: ["p1"] })).status).toBe(400);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  });
});
