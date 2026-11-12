// @vitest-environment node
// Wave E: "Tell client" about a lost item, sent from the app through the
// pipeline's LOST_ITEM_PROPERTY_CLIENT scope (administrators; explicit
// transports; the client's notification switch honoured; the timeline records
// the real states). Operations managers keep copy-and-record.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  session: vi.fn(), item: vi.fn(), itemOrThrow: vi.fn(), property: vi.fn(), events: vi.fn(), eventCreate: vi.fn(), auditFirst: vi.fn(), audit: vi.fn(),
  office: vi.fn(), controls: vi.fn(), settings: vi.fn(), user: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/office-sends", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/office-sends")>("@/lib/notifications/office-sends");
  return { ...actual, sendOfficeNotification: m.office };
});
vi.mock("@/lib/notifications/type-controls", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/type-controls")>("@/lib/notifications/type-controls");
  return { ...actual, getNotificationTypeControls: m.controls };
});
vi.mock("@/lib/lost-found/service", () => ({ hydrateItemWithEvents: async (item: unknown) => item, hydrateItems: async (items: Array<Record<string, unknown>>) => items.map((item) => ({ ...item, createdAt: "2026-11-10T01:00:00.000Z", propertyName: "Bondi Studio", propertyAddress: null, guestEmail: null })) }));
vi.mock("@/lib/db", () => ({ db: {
  lostFoundItem: { findUnique: m.item, findUniqueOrThrow: m.itemOrThrow },
  property: { findUnique: m.property },
  lostFoundEvent: { findMany: m.events, create: m.eventCreate },
  auditLog: { findFirst: m.auditFirst, create: m.audit },
  user: { findUnique: m.user },
} }));

import { POST as SEND } from "@/app/api/admin/lost-found/[id]/send-client-notice/route";
import { GET as MESSAGE } from "@/app/api/admin/lost-found/[id]/message/route";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";

const admin = { user: { id: "admin-1", role: Role.ADMIN } };
const ops = { user: { id: "ops-1", role: Role.OPS_MANAGER } };
const item = { id: "i1", itemName: "Watch", jobId: "job-1", propertyId: "p1", guestContact: null, foundLocation: null, guestName: null };
const clientProperty = (overrides: Record<string, unknown> = {}) => ({ name: "Bondi Studio", clientId: "cl1", client: { id: "cl1", name: "Harbour Stays", email: "owner@harbour.invalid", phone: null, notificationPref: { notificationsEnabled: true }, users: [{ id: "u-client", role: "CLIENT", name: "Owner", email: "owner@harbour.invalid" }], ...overrides } });
const body = (overrides: Record<string, unknown> = {}) => ({ transports: ["PUSH"], subject: "Lost property found", body: "We found a watch.", idempotencyKey: "lfc-1234567890", ...overrides });
const post = (payload: Record<string, unknown>) => SEND(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(payload) }) as never, { params: { id: "i1" } });

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue(admin);
  m.item.mockResolvedValue(item);
  m.itemOrThrow.mockResolvedValue(item);
  m.events.mockResolvedValue([]);
  m.property.mockResolvedValue(clientProperty());
  m.auditFirst.mockResolvedValue(null);
  m.controls.mockResolvedValue({ respectsPreferences: {}, disabledTransports: {}, updatedAt: null });
  m.settings.mockResolvedValue({ companyName: "sNeek", companyPhone: "", timezone: "Australia/Sydney" });
  m.office.mockResolvedValue([{ userId: "u-client", name: "Owner", transport: "INBOX", path: "pipeline", state: "inbox_available" }]);
});

describe("send", () => {
  it("sends through the lost item's property-client scope and records the real states on the timeline", async () => {
    const response = await post(body());
    expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({ taken: true, outcomes: [{ state: "inbox_available" }] });
    expect(m.office.mock.calls[0][0]).toMatchObject({ typeKey: "lostfound.client_notice", eventKey: "lostfound.client_notice", scopeType: "LOST_ITEM_PROPERTY_CLIENT", transports: ["PUSH"], recipients: [{ id: "u-client" }] });
    expect(m.office.mock.calls[0][0].scopeId()).toBe("i1");
    expect(m.eventCreate.mock.calls[0][0].data).toMatchObject({ itemId: "i1", action: "CLIENT_CONTACTED", meta: { sentByApp: true, deliveryConfirmed: false } });
    expect(m.eventCreate.mock.calls[0][0].data.note).toContain("inbox available");
  });

  it("records 'not sent' when no transport took it", async () => {
    m.office.mockResolvedValue([{ userId: "u-client", name: "Owner", transport: "EMAIL", path: "direct", state: "skipped", errorCode: "recipient_preference" }]);
    await post(body({ transports: ["EMAIL"] }));
    expect(m.eventCreate.mock.calls[0][0].data).toMatchObject({ action: "MESSAGE_NOT_SENT" });
  });

  it("honours the client's own switch and refuses a client with no login", async () => {
    m.property.mockResolvedValueOnce(clientProperty({ notificationPref: { notificationsEnabled: false } }));
    const off = await post(body());
    expect(off.status).toBe(409);
    expect((await off.json()).error).toMatch(/switched off/);
    m.property.mockResolvedValueOnce(clientProperty({ users: [] }));
    expect((await post(body())).status).toBe(400);
    expect(m.office).not.toHaveBeenCalled();
  });

  it("is administrators only and not while impersonating", async () => {
    m.session.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await post(body())).status).toBe(403);
    expect(m.session).toHaveBeenLastCalledWith([Role.ADMIN]);
    m.session.mockResolvedValueOnce({ ...admin, impersonation: { actorId: "owner" } });
    expect((await post(body())).status).toBe(403);
    expect(m.office).not.toHaveBeenCalled();
  });

  it("does not add a second timeline entry for a retry of the same request", async () => {
    m.auditFirst.mockResolvedValue({ id: "audit-1" });
    await post(body());
    expect(m.eventCreate).not.toHaveBeenCalled();
  });
});

describe("message preview", () => {
  const get = () => MESSAGE({ nextUrl: new URL("http://localhost/x?audience=client") } as never, { params: { id: "i1" } });
  it("offers the send to administrators and copy-and-record to operations managers", async () => {
    expect((await (await get()).json()).send).toMatchObject({ available: true, logins: 1 });
    m.session.mockResolvedValue(ops);
    expect((await (await get()).json()).send).toMatchObject({ available: false, reason: expect.stringMatching(/Only administrators/) });
  });
  it("says why it cannot send when the client switched notifications off", async () => {
    m.property.mockResolvedValue(clientProperty({ notificationPref: { notificationsEnabled: false } }));
    expect((await (await get()).json()).send).toMatchObject({ available: false, reason: expect.stringMatching(/switched off/) });
  });
});

describe("LOST_ITEM_PROPERTY_CLIENT scope", () => {
  const recipient = { userId: "u-client", role: "CLIENT" as const, scope: { kind: "ENTITY" as const, type: "LOST_ITEM_PROPERTY_CLIENT", id: "i1" } };
  const reader = { user: { findUnique: m.user }, lostFoundItem: { findUnique: m.item }, property: { findUnique: m.property } };
  it("authorizes only an active client login of the item's property client, re-read each time", async () => {
    m.user.mockResolvedValue({ id: "u-client", role: "CLIENT", isActive: true, clientId: "cl1" });
    m.property.mockResolvedValue({ clientId: "cl1" });
    expect(await authorizeEntityRecipient(reader as never, recipient)).toEqual({ ok: true, role: "CLIENT" });
    m.property.mockResolvedValue({ clientId: "someone-else" });
    expect(await authorizeEntityRecipient(reader as never, recipient)).toMatchObject({ ok: false, errorCode: "recipient_not_in_scope" });
    m.item.mockResolvedValue({ propertyId: null });
    expect(await authorizeEntityRecipient(reader as never, recipient)).toMatchObject({ ok: false });
  });
  it("fails closed when the reader cannot read items", async () => {
    m.user.mockResolvedValue({ id: "u-client", role: "CLIENT", isActive: true, clientId: "cl1" });
    expect(await authorizeEntityRecipient({ user: { findUnique: m.user } } as never, recipient)).toMatchObject({ ok: false });
  });
});
