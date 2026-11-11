// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  foreign: vi.fn(),
  bulk: vi.fn(),
  workflow: vi.fn(),
  db: {
    property: { findUnique: vi.fn() },
    job: { findUnique: vi.fn() },
    lostFoundItem: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    lostFoundEvent: { findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://files.invalid/${key}` }));
vi.mock("@/lib/uploads/ownership-server", () => ({ findForeignUploadKeys: m.foreign }));
vi.mock("@/lib/lost-found/create", () => ({ createLostFoundItem: m.create }));
vi.mock("@/lib/lost-found/list", async (importOriginal) => ({ ...(await importOriginal<object>()), listLostFoundForOffice: m.list }));
vi.mock("@/lib/lost-found/service", async (importOriginal) => ({ ...(await importOriginal<object>()), hydrateItems: async (items: unknown[]) => items, hydrateItemWithEvents: async (item: object) => ({ ...item, events: [] }) }));
vi.mock("@/lib/lost-found/bulk", async (importOriginal) => ({ ...(await importOriginal<object>()), runLostFoundBulk: m.bulk }));
vi.mock("@/lib/lost-found/mutations", async (importOriginal) => ({ ...(await importOriginal<object>()), recordLostFoundWorkflow: m.workflow }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", companyName: "sNeek", companyPhone: "" }) }));

import { GET as listGet, POST as officeCreate } from "@/app/api/admin/lost-found/route";
import { POST as bulkPost } from "@/app/api/admin/lost-found/bulk/route";
import { POST as eventsPost } from "@/app/api/lost-found/[id]/events/route";
import { LostFoundRuleError } from "@/lib/lost-found/mutations";

const json = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "office", role: "OPS_MANAGER" } });
  m.foreign.mockResolvedValue([]);
  m.db.property.findUnique.mockResolvedValue({ id: "p1" });
  m.db.job.findUnique.mockResolvedValue({ propertyId: "p1" });
  m.create.mockResolvedValue({ id: "new-item" });
});

describe("office logs an item", () => {
  it("lets ADMIN and OPS_MANAGER log one with the property required and derives photo links from keys", async () => {
    const response = await officeCreate(json("https://app.invalid/api/admin/lost-found", { propertyId: "p1", jobId: "j1", itemName: "Watch", location: "Bedside", photos: [{ key: "lost-found/office/a.jpg", url: "https://evil.invalid/x.jpg" }] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, itemId: "new-item" });
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ actorId: "office", propertyId: "p1", jobId: "j1", loggedBy: "OFFICE", photos: [{ key: "lost-found/office/a.jpg", url: "https://files.invalid/lost-found/office/a.jpg", caption: null }] }));
  });
  it("refuses other roles, a missing property, a job at another property and someone else's uploads", async () => {
    m.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await officeCreate(json("https://app.invalid/api/admin/lost-found", { propertyId: "p1", itemName: "Watch" }))).status).toBe(403);
    const noProperty = await officeCreate(json("https://app.invalid/api/admin/lost-found", { itemName: "Watch" }));
    expect(noProperty.status).toBe(400);
    m.db.property.findUnique.mockResolvedValueOnce(null);
    expect((await officeCreate(json("https://app.invalid/api/admin/lost-found", { propertyId: "gone", itemName: "Watch" }))).status).toBe(404);
    m.db.job.findUnique.mockResolvedValueOnce({ propertyId: "elsewhere" });
    expect((await officeCreate(json("https://app.invalid/api/admin/lost-found", { propertyId: "p1", jobId: "j9", itemName: "Watch" }))).status).toBe(400);
    m.foreign.mockResolvedValueOnce(["lost-found/other/b.jpg"]);
    expect((await officeCreate(json("https://app.invalid/api/admin/lost-found", { propertyId: "p1", itemName: "Watch", photos: [{ key: "lost-found/other/b.jpg", url: "x" }] }))).status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe("admin list", () => {
  it("serves the paged office table only when asked, and the old board shape otherwise", async () => {
    m.list.mockResolvedValue({ rows: [], total: 0 });
    const paged = await listGet(new NextRequest("https://app.invalid/api/admin/lost-found?paginated=1&stage=storage&sort=found&dir=asc"));
    expect(paged.status).toBe(200);
    expect(m.list).toHaveBeenCalledWith(expect.objectContaining({ tab: "storage" }), expect.objectContaining({ sort: "found", dir: "asc", page: 1, pageSize: 25 }));
    expect((await listGet(new NextRequest("https://app.invalid/api/admin/lost-found?paginated=1&sort=propertyName"))).status).toBe(400);

    m.db.lostFoundItem.findMany.mockResolvedValue([{ id: "i1", propertyId: "p1", propertyName: "Bondi" }]);
    m.db.lostFoundItem.count.mockResolvedValue(3);
    const old = await listGet(new NextRequest("https://app.invalid/api/admin/lost-found?status=REPORTED"));
    expect(Object.keys(await old.json()).sort()).toEqual(["items", "openCount", "properties"]);
  });
});

describe("bulk and workflow routes", () => {
  it("bulk answers per row and keeps the office role guard", async () => {
    m.bulk.mockResolvedValue({ results: [{ id: "a", outcome: "done", message: "Updated." }, { id: "b", outcome: "refused", message: "Reopen the item first to record a different final decision." }] });
    const response = await bulkPost(json("https://app.invalid/api/admin/lost-found/bulk", { action: "donate", ids: ["a", "b"] }));
    expect(await response.json()).toMatchObject({ results: [{ outcome: "done" }, { outcome: "refused" }] });
    expect(m.bulk).toHaveBeenCalledWith("office", { action: "donate", ids: ["a", "b"] });
    m.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await bulkPost(json("https://app.invalid/api/admin/lost-found/bulk", { action: "donate", ids: ["a"] }))).status).toBe(403);
  });
  it("a cleaner cannot mark contact; a closed item answers 409 with the rule", async () => {
    m.db.lostFoundItem.findUnique.mockResolvedValue({ id: "i1", reportedByUserId: "cleaner", status: "DONATED" });
    m.requireRole.mockResolvedValueOnce({ user: { id: "cleaner", role: "CLEANER" } });
    expect((await eventsPost(json("https://app.invalid/api/lost-found/i1/events", { action: "GUEST_CONTACTED" }), { params: { id: "i1" } })).status).toBe(403);
    m.workflow.mockRejectedValueOnce(new LostFoundRuleError("This item is closed. Reopen it first, with a reason."));
    const closed = await eventsPost(json("https://app.invalid/api/lost-found/i1/events", { action: "GUEST_CONTACTED", channel: "EMAIL" }), { params: { id: "i1" } });
    expect(closed.status).toBe(409);
    expect(m.workflow).toHaveBeenCalledWith("i1", "office", expect.objectContaining({ action: "GUEST_CONTACTED", channel: "EMAIL" }));
  });
});
