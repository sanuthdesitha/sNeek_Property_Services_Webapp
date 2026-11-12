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
  sendGuest: vi.fn(),
  db: {
    property: { findUnique: vi.fn() },
    job: { findUnique: vi.fn() },
    lostFoundItem: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(async () => ({ id: "i1" })) },
    lostFoundEvent: { findMany: vi.fn(async () => []), create: vi.fn() },
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
vi.mock("@/lib/notifications/guest-message", () => ({ sendGuestMessage: m.sendGuest, GuestMessageError: class extends Error { status = 429; } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", companyName: "sNeek", companyPhone: "" }) }));

import { GET as listGet, POST as officeCreate } from "@/app/api/admin/lost-found/route";
import { POST as bulkPost } from "@/app/api/admin/lost-found/bulk/route";
import { POST as eventsPost } from "@/app/api/lost-found/[id]/events/route";
import { LostFoundRuleError } from "@/lib/lost-found/mutations";
import { GET as messageGet } from "@/app/api/admin/lost-found/[id]/message/route";
import { POST as sendGuestPost } from "@/app/api/admin/lost-found/[id]/send-guest-message/route";

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

describe("message guest / tell client", () => {
  // Wave E changed the client half on purpose: "Tell client" is now sendable
  // from the app by an administrator when the property's client has a login.
  it("lets only an administrator send a guest message from the app; a client message only when the client can be reached", async () => {
    m.db.lostFoundItem.findUnique.mockResolvedValue({ id: "i1", itemName: "Watch", createdAt: "2026-11-10T00:00:00.000Z", foundLocation: null, propertyId: "p1", propertyName: "Bondi", propertyAddress: null, guestName: null, guestEmail: "g@example.invalid", guestContact: null });
    m.db.property.findUnique.mockResolvedValue({ name: "Bondi", client: { id: "cl1", name: "Harbour Stays", email: null, phone: null, notificationPref: null, users: [] } });
    m.requireRole.mockResolvedValueOnce({ user: { id: "admin", role: "ADMIN" } });
    expect((await (await messageGet(new NextRequest("https://app.invalid/x?audience=guest"), { params: { id: "i1" } })).json()).send.available).toBe(true);
    m.requireRole.mockResolvedValueOnce({ user: { id: "admin", role: "ADMIN" }, impersonation: { actorId: "a" } });
    expect((await (await messageGet(new NextRequest("https://app.invalid/x?audience=guest"), { params: { id: "i1" } })).json()).send.available).toBe(false);
    m.requireRole.mockResolvedValueOnce({ user: { id: "admin", role: "ADMIN" } });
    expect((await (await messageGet(new NextRequest("https://app.invalid/x?audience=client"), { params: { id: "i1" } })).json()).send).toMatchObject({ available: false, reason: expect.stringMatching(/no active login/) });
    m.db.property.findUnique.mockResolvedValue({ name: "Bondi", client: { id: "cl1", name: "Harbour Stays", email: null, phone: null, notificationPref: null, users: [{ id: "u1", role: "CLIENT", name: "Owner", email: null }] } });
    m.requireRole.mockResolvedValueOnce({ user: { id: "admin", role: "ADMIN" } });
    expect((await (await messageGet(new NextRequest("https://app.invalid/x?audience=client"), { params: { id: "i1" } })).json()).send.available).toBe(true);
    m.requireRole.mockResolvedValueOnce({ user: { id: "ops", role: "OPS_MANAGER" } });
    expect((await (await messageGet(new NextRequest("https://app.invalid/x?audience=client"), { params: { id: "i1" } })).json()).send.available).toBe(false);
  });

  it("moves the item to Guest contacted only when the provider accepted the message, and never says delivered", async () => {
    const payload = { transport: "EMAIL", to: "g@example.invalid", subject: "Item found", body: "Hello", idempotencyKey: "lf-key-0001" };
    m.requireRole.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    m.sendGuest.mockResolvedValueOnce({ state: "provider_accepted", errorCode: null });
    const accepted = await (await sendGuestPost(json("https://app.invalid/x", payload), { params: { id: "i1" } })).json();
    expect(m.sendGuest).toHaveBeenCalledWith("admin", { lostFoundItemId: "i1", ...payload });
    expect(accepted.outcome).toMatchObject({ accepted: true, note: expect.stringContaining("delivery is not confirmed") });
    expect(m.workflow).toHaveBeenCalledWith("i1", "admin", expect.objectContaining({ action: "GUEST_CONTACTED", channel: "EMAIL" }));
    expect(JSON.stringify(accepted)).not.toMatch(/delivered/i);

    m.workflow.mockClear();
    m.sendGuest.mockResolvedValueOnce({ state: "failed", errorCode: "email_rejected" });
    const failed = await (await sendGuestPost(json("https://app.invalid/x", payload), { params: { id: "i1" } })).json();
    expect(failed.outcome).toMatchObject({ accepted: false, state: "failed" });
    expect(m.workflow).not.toHaveBeenCalled();
    expect(m.db.lostFoundEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "MESSAGE_NOT_SENT" }) });

    m.requireRole.mockResolvedValueOnce({ user: { id: "admin", role: "ADMIN" }, impersonation: { actorId: "a" } });
    expect((await sendGuestPost(json("https://app.invalid/x", payload), { params: { id: "i1" } })).status).toBe(403);
    m.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await sendGuestPost(json("https://app.invalid/x", payload), { params: { id: "i1" } })).status).toBe(403);
    m.requireRole.mockResolvedValue({ user: { id: "office", role: "OPS_MANAGER" } });
  });

  it("drafts the message but never claims the app can send or deliver it", async () => {
    m.db.lostFoundItem.findUnique.mockResolvedValue({ id: "i1", itemName: "Watch", createdAt: "2026-11-10T00:00:00.000Z", foundLocation: "Bedside", propertyId: "p1", propertyName: "Bondi", propertyAddress: "1 Test St", guestName: "Priya Shah", guestEmail: null, guestContact: "priya@example.invalid or 0400 111 222" });
    m.db.property.findUnique.mockResolvedValue({ name: "Bondi", client: { name: "Harbour Stays", email: "office@harbour.invalid", phone: null } });
    const guest = await (await messageGet(new NextRequest("https://app.invalid/api/admin/lost-found/i1/message?audience=guest"), { params: { id: "i1" } })).json();
    // An operations manager cannot send a guest message from the app.
    expect(guest.send).toEqual({ available: false, reason: expect.stringMatching(/Only administrators/) });
    expect(guest.recipient).toEqual({ name: "Priya Shah", email: "priya@example.invalid", phone: "0400111222" });
    expect(guest.draft.body).toContain("Watch (Bedside)");
    const client = await (await messageGet(new NextRequest("https://app.invalid/api/admin/lost-found/i1/message?audience=client"), { params: { id: "i1" } })).json();
    expect(client.recipient).toEqual({ name: "Harbour Stays", email: "office@harbour.invalid", phone: null });
    expect(client.send.available).toBe(false);
  });
});
