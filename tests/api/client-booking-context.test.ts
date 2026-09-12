// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { bookingIdentity } from "@/lib/booking/idempotency";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), settings: vi.fn(), user: vi.fn(), client: vi.fn(), property: vi.fn(),
  transaction: vi.fn(), lead: vi.fn(), transactionAudit: vi.fn(), portalAudit: vi.fn(),
  quote: vi.fn(), push: vi.fn(), email: vi.fn(),
  replay: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/db", () => ({ db: {
  user: { findUnique: mocks.user }, client: { findUnique: mocks.client },
  property: { findFirst: mocks.property }, $transaction: mocks.transaction,
  auditLog: { create: mocks.portalAudit },
} }));
vi.mock("@/lib/booking/requests", () => ({ BOOKING_REQUEST_VIA: "client_booking" }));
vi.mock("@/lib/pricing/calculator", () => ({ calculateQuote: mocks.quote }));
vi.mock("@/lib/notifications/admin-alerts", () => ({
  notifyAdminsByPush: mocks.push, notifyAdminsByEmail: mocks.email,
}));

import { POST } from "@/app/api/client/booking/route";

const client = { id: "authorized-client", name: "Harbour Stays", email: "bookings@example.test", phone: "0400000001" };
const property = { id: "allowed-property", name: "Harbour apartment", address: "1 Test Street", suburb: "Sydney", bedrooms: 2, bathrooms: 1 };
const body = { propertyId: property.id, jobType: "GENERAL_CLEAN", scheduledDate: "2099-09-10", notes: "Side entrance" };

function actor(role: Role, clientId: string | null = null, permissions = { bookings: true }) {
  mocks.session.mockResolvedValue({ user: { id: "acting-user", role } });
  mocks.user.mockResolvedValue({
    id: "acting-user", name: "Acting Person", email: "actor@example.test", phone: "0499999999", clientId,
    client: clientId ? { id: clientId, name: "Actor-linked company", email: "wrong@example.test", phone: "0488888888", portalVisibilityOverrides: null } : null,
    vaTeam: role === Role.VA ? {
      id: "team-1", name: "Office", isActive: true, clientId: client.id,
      client: { ...client, portalVisibilityOverrides: null },
      propertyIds: [property.id], permissions,
    } : null,
  });
}

function request(payload: unknown = body, key?: string) {
  return POST(new NextRequest("http://localhost/api/client/booking", {
    method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(payload),
  }));
}
function expectNoMutation() {
  for (const fn of [mocks.transaction, mocks.lead, mocks.transactionAudit, mocks.portalAudit, mocks.quote, mocks.push, mocks.email]) {
    expect(fn).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  actor(Role.VA);
  mocks.settings.mockResolvedValue({ clientPortalVisibility: { showBooking: true } });
  mocks.client.mockResolvedValue(client);
  mocks.property.mockResolvedValue(property);
  mocks.quote.mockResolvedValue({ total: 123.456 });
  mocks.lead.mockResolvedValue({ id: "lead-1" });
  mocks.transactionAudit.mockResolvedValue({ id: "audit-1" });
  mocks.portalAudit.mockResolvedValue({ id: "audit-2" });
  mocks.transaction.mockImplementation(async (fn) => fn({
    quoteLead: { create: mocks.lead, findUnique: mocks.replay }, auditLog: { create: mocks.transactionAudit }, $executeRaw: mocks.lock,
  }));
  mocks.replay.mockResolvedValue(null);
  mocks.lock.mockResolvedValue([]);
  mocks.push.mockResolvedValue(undefined);
  mocks.email.mockResolvedValue(undefined);
});

describe("booking authoritative client and actor attribution", () => {
  it.each([
    ["VA without a client link", Role.VA, null],
    ["VA with a different client link", Role.VA, "wrong-client"],
    ["CLIENT", Role.CLIENT, client.id],
  ])("uses the authorized client's ownership and contacts for %s", async (_label, role, clientId) => {
    actor(role as Role, clientId);
    const result = await request({ ...body, clientId: "payload-client", name: "Payload name", email: "payload@example.test" });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, requestId: "lead-1", pendingApproval: true });
    expect(mocks.client).toHaveBeenCalledTimes(1);
    expect(mocks.client).toHaveBeenCalledWith({
      where: { id: client.id }, select: { name: true, email: true, phone: true },
    });
    expect(mocks.lead).toHaveBeenCalledTimes(1);
    expect(mocks.lead.mock.lastCall![0].data).toEqual({
      clientId: client.id, serviceType: body.jobType, name: client.name, email: client.email, phone: client.phone,
      address: property.address, suburb: property.suburb, bedrooms: 2, bathrooms: 1,
      notes: body.notes, estimateMin: 123.46, estimateMax: 123.46, requestedServiceLabel: "GENERAL CLEAN", status: "NEW",
      structuredContext: {
        createdVia: "client_booking", propertyId: property.id, jobType: body.jobType,
        scheduledDate: body.scheduledDate, requestedByUserId: "acting-user",
      },
    });
    expect(mocks.transactionAudit).toHaveBeenCalledWith({ data: {
      userId: "acting-user", action: "CLIENT_BOOKING_REQUESTED", entity: "QuoteLead", entityId: "lead-1",
      after: { propertyId: property.id, jobType: body.jobType, scheduledDate: body.scheduledDate },
    } });
    expect(mocks.transactionAudit).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "acting-user", action: "booking.request", entityId: "lead-1",
      after: expect.objectContaining({ actor: role, onBehalfOfClientId: client.id, vaTeamId: role === Role.VA ? "team-1" : null }),
    }) });
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith({
      subject: "Booking request awaiting approval: Harbour apartment",
      body: "Harbour Stays requested GENERAL CLEAN on 2099-09-10 for Harbour apartment. Approve it to create the job.",
    });
    expect(mocks.email).toHaveBeenCalledTimes(1);
    expect(mocks.email.mock.lastCall![0]).toMatchObject({
      subject: "Booking request awaiting approval: Harbour apartment", html: expect.stringContaining("<strong>Client:</strong> Harbour Stays"),
    });
    expect(JSON.stringify(mocks.lead.mock.calls)).not.toMatch(/wrong-client|actor@example|Payload name/);
    expect(mocks.quote).toHaveBeenCalledWith({ serviceType: body.jobType, bedrooms: 2, bathrooms: 1 });
  });

  it("does not fall back to actor contacts when client contacts are empty", async () => {
    mocks.client.mockResolvedValue({ ...client, name: "", email: "", phone: null });
    expect((await request()).status).toBe(200);
    expect(mocks.lead.mock.lastCall![0].data).toMatchObject({ clientId: client.id, name: "Client", email: "", phone: undefined });
    expect(mocks.push.mock.lastCall![0].body).toMatch(/^Client requested/);
  });

  it("fails closed when the authorized client no longer exists", async () => {
    mocks.client.mockResolvedValue(null);
    const result = await request();
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "Account not found." });
    expect(mocks.property).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it("fails closed on a client read failure", async () => {
    mocks.client.mockRejectedValue(new Error("read unavailable"));
    expect((await request()).status).toBe(400);
    expectNoMutation();
  });

  it("keeps existing quote failure fallback and pending-request behavior", async () => {
    mocks.quote.mockRejectedValue(new Error("pricing unavailable"));
    expect((await request()).status).toBe(200);
    expect(mocks.lead.mock.lastCall![0].data).toMatchObject({ estimateMin: undefined, estimateMax: undefined, status: "NEW" });
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.email).toHaveBeenCalledTimes(1);
  });

  it("returns the committed request even when a notification fails", async () => {
    mocks.push.mockRejectedValue(new Error("push unavailable"));
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, warning: "Request received. Some staff notifications could not be confirmed." });
    expect(mocks.lead).toHaveBeenCalledTimes(1);
    expect(mocks.transactionAudit).toHaveBeenCalledTimes(2);
    expect(mocks.email).toHaveBeenCalledTimes(1);
    expect(mocks.portalAudit).not.toHaveBeenCalled();
  });
});

describe("booking retry identity", () => {
  const key = "303412ed-b125-431a-870f-a76577bf1bc6";
  it("stores the receipt in the created lead and uses a transaction lock", async () => {
    expect((await request(body, key)).status).toBe(200);
    const identity = bookingIdentity("acting-user", client.id, key, body);
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.lead.mock.lastCall![0].data).toMatchObject({ id: identity.id, structuredContext: { bookingFingerprint: identity.fingerprint } });
    expect(mocks.transactionAudit).toHaveBeenCalledTimes(2);
    expect(mocks.portalAudit).not.toHaveBeenCalled();
  });
  it("replays the existing request without writes or notifications", async () => {
    const identity = bookingIdentity("acting-user", client.id, key, body);
    mocks.replay.mockResolvedValue({ id: identity.id, structuredContext: { bookingFingerprint: identity.fingerprint } });
    const response = await request(body, key);
    expect(await response.json()).toEqual({ ok: true, requestId: identity.id, pendingApproval: true });
    for (const fn of [mocks.lead, mocks.transactionAudit, mocks.portalAudit, mocks.push, mocks.email]) expect(fn).not.toHaveBeenCalled();
  });
  it.each(["payload", "client", "missing receipt"])("rejects a reused key with different %s", async (kind) => {
    const identity = bookingIdentity("acting-user", kind === "client" ? "other-client" : client.id, key,
      kind === "payload" ? { ...body, notes: "different" } : body);
    mocks.replay.mockResolvedValue({ id: identity.id, structuredContext: kind === "missing receipt" ? {} : { bookingFingerprint: identity.fingerprint } });
    expect((await request(body, key)).status).toBe(409);
    for (const fn of [mocks.lead, mocks.transactionAudit, mocks.push, mocks.email]) expect(fn).not.toHaveBeenCalled();
  });
  it("checks current permission before returning a stored receipt", async () => {
    actor(Role.VA, null, { bookings: false });
    expect((await request(body, key)).status).toBe(403);
    expect(mocks.replay).not.toHaveBeenCalled();
  });
  it("rejects malformed keys before booking reads", async () => {
    expect((await request(body, "bad-key")).status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled();
    expectNoMutation();
  });
  it("does not notify when transaction audit fails", async () => {
    mocks.transactionAudit.mockRejectedValue(new Error("Audit unavailable"));
    expect((await request(body, key)).status).toBe(400);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
});

describe("booking denial and property boundary", () => {
  it("rejects a VA without bookings permission before reading booking data", async () => {
    actor(Role.VA, "wrong-client", { bookings: false });
    expect((await request()).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.property).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it.each(["UNAUTHORIZED", "FORBIDDEN"])("does not mutate for %s", async (error) => {
    mocks.session.mockRejectedValue(new Error(error));
    expect((await request()).status).toBe(error === "UNAUTHORIZED" ? 401 : 403);
    expect(mocks.client).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it("does not mutate when booking visibility is disabled", async () => {
    mocks.settings.mockResolvedValue({ clientPortalVisibility: { showBooking: false } });
    expect((await request()).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it("keeps requested id, client ownership, active state and VA restriction together", async () => {
    mocks.property.mockResolvedValue(null);
    const result = await request({ ...body, propertyId: "outside-scope" });
    expect(result.status).toBe(404);
    expect(mocks.property).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: "outside-scope", clientId: client.id, isActive: true, AND: [{ id: { in: [property.id] } }],
    } }));
    expectNoMutation();
  });

  it("keeps client ownership and active property checks for CLIENT bookings", async () => {
    actor(Role.CLIENT, client.id);
    mocks.property.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.property).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: property.id, clientId: client.id, isActive: true,
    } }));
    expectNoMutation();
  });

  it("rejects invalid input before contact lookup or mutation", async () => {
    expect((await request({ ...body, scheduledDate: "not-a-date" })).status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled();
    expectNoMutation();
  });
});
