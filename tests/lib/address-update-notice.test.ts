// @vitest-environment node
/**
 * "Please check your home address" (catalog workforce.address_update_request):
 * an inbox notice through the notification pipeline with explicit transports
 * ["INBOX"] and scope STAFF_MEMBER; at most once per cleaner per Sydney day;
 * only cleaners whose address still needs attention; one audit row without
 * addresses. The route is ADMIN only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  people: [] as unknown[],
  claims: new Set<string>(),
  send: vi.fn(),
  audit: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { user: { findMany: vi.fn(async () => m.people) }, auditLog: { create: m.audit } } }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.send }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: async () => ({ disabledTransports: {} }) }));
vi.mock("@/lib/notifications/wording/render", async (original) => {
  const actual = await original<typeof import("@/lib/notifications/wording/render")>();
  return { ...actual, loadNotificationWording: async (type: string) => actual.defaultNotificationWording(type) };
});
vi.mock("@/lib/notifications/dispatch-once", () => ({
  dispatchNotificationOnce: async (identity: { event: string; day: string; recipientId: string }, send: () => Promise<void>) => {
    const key = JSON.stringify(identity);
    if (m.claims.has(key)) return false;
    m.claims.add(key);
    await send();
    return true;
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));

import { ADDRESS_UPDATE_TYPE, sendAddressUpdateRequests } from "@/lib/workforce/address-update-notice";
import { POST } from "@/app/api/admin/cleaners/addresses/update-request/route";
import { catalogEntry } from "@/lib/notifications/catalog";

const NOAH = { id: "c3", role: Role.CLEANER, name: "Noah Patel", email: "noah@x", address: null, suburb: "Marrickville", latitude: null, longitude: null };
const RUBY = { id: "c1", role: Role.CLEANER, name: "Ruby Chen", email: "ruby@x", address: "2 Darling St", suburb: "Balmain", latitude: -33.8, longitude: 151.1 };
const NOW = new Date("2026-11-17T01:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  m.claims = new Set();
  m.people = [NOAH, RUBY];
  m.send.mockImplementation(async (input: { recipients: Array<{ id: string; name: string }> }) => input.recipients.map((recipient) => ({ userId: recipient.id, name: recipient.name, transport: "INBOX", path: "pipeline", state: "inbox_available" })));
  m.audit.mockResolvedValue({});
  m.requireRole.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN } });
});

describe("sendAddressUpdateRequests", () => {
  it("sends an inbox-only notice through the pipeline, scoped to the cleaner", async () => {
    const outcomes = await sendAddressUpdateRequests({ actorId: "admin-1", cleanerIds: ["c3"], now: NOW });
    expect(outcomes).toEqual([{ userId: "c3", name: "Noah Patel", state: "inbox_available", errorCode: null }]);
    expect(m.send).toHaveBeenCalledTimes(1);
    const input = m.send.mock.calls[0][0];
    expect(input).toMatchObject({
      typeKey: ADDRESS_UPDATE_TYPE,
      eventKey: "workforce.address_update_request",
      eventId: "cleaner-address-update:c3:2026-11-17",
      transports: ["INBOX"],
      scopeType: "STAFF_MEMBER",
      actorId: "admin-1",
      url: "/v2/cleaner/profile",
    });
    expect(input.scopeId({ id: "c3" })).toBe("c3");
    expect(input.email).toBeUndefined();
    expect(input.subject).toBe("Please check your home address");
    expect(input.body).toContain("We have your suburb but no street address.");
    expect(input.body).not.toContain("Marrickville");
  });

  it("asks each cleaner at most once a day", async () => {
    await sendAddressUpdateRequests({ actorId: "admin-1", cleanerIds: ["c3"], now: NOW });
    const again = await sendAddressUpdateRequests({ actorId: "admin-2", cleanerIds: ["c3"], now: NOW });
    expect(again).toEqual([{ userId: "c3", name: "Noah Patel", state: "already_asked_today" }]);
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it("refuses people whose address is placed or who are not active cleaners, with a reason", async () => {
    const outcomes = await sendAddressUpdateRequests({ actorId: "admin-1", cleanerIds: ["c1", "ghost"], now: NOW });
    expect(outcomes).toEqual([
      { userId: "c1", name: "Ruby Chen", state: "not_needed", errorCode: "address_already_placed" },
      { userId: "ghost", name: "Unknown", state: "not_found", errorCode: "not_an_active_cleaner" },
    ]);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("writes one audit row with outcomes and no addresses", async () => {
    await sendAddressUpdateRequests({ actorId: "admin-1", cleanerIds: ["c3", "c1"], now: NOW });
    expect(m.audit).toHaveBeenCalledTimes(1);
    const record = m.audit.mock.calls[0][0];
    expect(record.data).toMatchObject({ userId: "admin-1", action: "CLEANER_ADDRESS_UPDATE_REQUESTED", after: { transports: ["INBOX"] } });
    expect(JSON.stringify(record)).not.toContain("Darling");
    expect(JSON.stringify(record)).not.toContain("Marrickville");
  });

  it("says an unknown send outcome is unknown, not failed, and does not resend", async () => {
    m.send.mockRejectedValueOnce(new Error("timeout"));
    const first = await sendAddressUpdateRequests({ actorId: "admin-1", cleanerIds: ["c3"], now: NOW });
    expect(first[0].state).toBe("uncertain");
    const second = await sendAddressUpdateRequests({ actorId: "admin-1", cleanerIds: ["c3"], now: NOW });
    expect(second[0].state).toBe("already_asked_today");
  });

  it("has a catalog entry that is inbox only on the pipeline", () => {
    const entry = catalogEntry(ADDRESS_UPDATE_TYPE);
    expect(entry).toMatchObject({ transports: ["INBOX"], defaultTransports: ["INBOX"], path: "PIPELINE", audienceKeys: ["CLEANER"] });
    expect(entry?.producers).toContain("lib/workforce/address-update-notice.ts");
  });
});

describe("POST /api/admin/cleaners/addresses/update-request", () => {
  const post = (body: unknown) => POST(new Request("http://localhost/api/admin/cleaners/addresses/update-request", { method: "POST", body: JSON.stringify(body) }) as never);

  it("is ADMIN only (operations managers refused) and records the real administrator", async () => {
    m.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await post({ cleanerIds: ["c3"] })).status).toBe(403);
    expect(m.requireRole).toHaveBeenCalledWith([Role.ADMIN]);
    m.requireRole.mockResolvedValueOnce({ user: { id: "admin-2", role: Role.ADMIN }, impersonation: { actorId: "admin-1", mode: "FULL", startedAt: 1 } });
    const response = await post({ cleanerIds: ["c3"] });
    expect(response.status).toBe(200);
    expect(m.send.mock.calls[0][0].actorId).toBe("admin-1");
  });

  it("refuses an empty request", async () => {
    expect((await post({ cleanerIds: [] })).status).toBe(400);
    expect(m.send).not.toHaveBeenCalled();
  });
});
