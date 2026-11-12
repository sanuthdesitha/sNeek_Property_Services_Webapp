// @vitest-environment node
/**
 * "Ask laundry team" requests (owner, 2026-11-12: pickup and drop-off are the
 * laundry partner's work): recipients are the LAUNDRY users of the run's
 * supplier who may see the property, checked when queued and again at
 * dispatch (scope LAUNDRY_TASK_SUPPLIER_TEAM); a partner without such users is
 * refused with the reason; the request must still apply; same cool-down.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ task: vi.fn(), users: vi.fn(), user: vi.fn(), audit: vi.fn(), recent: vi.fn(), office: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    laundryTask: { findUnique: m.task },
    user: { findMany: m.users, findUnique: m.user },
    auditLog: { create: m.audit, findFirst: m.recent },
    appSetting: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: async () => ({ respectsPreferences: {}, disabledTransports: {} }), typeRespectsPreferences: () => false }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", laundryOperations: { maxOutdoorDays: 3 }, laundryPortalVisibility: { requireDropoffPhoto: true } }) }));

import { sendLaundryTeamRequest, OfficeActionError } from "@/lib/notifications/office-actions";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";
import { db } from "@/lib/db";

const property = { name: "Bondi Flat", suburb: "Bondi", accessInfo: null, laundryEnabled: true };
const deliveredWithoutPhoto = {
  id: "t1", jobId: "j1", status: "DROPPED", pickupDate: new Date("2026-11-09T13:00:00Z"), dropoffDate: new Date("2026-11-10T13:00:00Z"), pickedUpAt: new Date("2026-11-10T00:00:00Z"), flagReason: null,
  supplierId: "s1", supplier: { id: "s1", name: "Fresh Linen", avgTurnaround: 48 }, property, job: { status: "COMPLETED" }, confirmations: [],
};
const tom = { id: "l1", name: "Tom", email: "tom@example.invalid", role: "LAUNDRY", laundrySupplierId: "s1" };

beforeEach(() => {
  vi.resetAllMocks();
  m.task.mockResolvedValue(deliveredWithoutPhoto);
  m.users.mockResolvedValue([tom]);
  m.recent.mockResolvedValue(null);
  m.office.mockResolvedValue([{ userId: "l1", name: "Tom", transport: "INBOX", path: "pipeline", state: "queued" }]);
});

describe("sendLaundryTeamRequest", () => {
  it("addresses the partner's laundry users through the supplier-team scope and audits the request", async () => {
    const result = await sendLaundryTeamRequest("ops-1", { laundryTaskId: "t1", kind: "TEAM_PHOTO", transports: ["PUSH"], idempotencyKey: "nudge:t1:TEAM_PHOTO:1" });
    expect(result.outcomes[0].state).toBe("queued");
    expect(m.users.mock.calls[0][0].where).toEqual({ role: "LAUNDRY", isActive: true, laundrySupplierId: { in: ["s1"] } });
    const call = m.office.mock.calls[0][0];
    expect(call).toMatchObject({ typeKey: "laundry.team_request", scopeType: "LAUNDRY_TASK_SUPPLIER_TEAM", category: "laundry", subject: "Drop-off photo requested", recipients: [{ id: "l1", role: "LAUNDRY" }] });
    expect(call.scopeId()).toBe("t1");
    expect(call.body).toContain("Bondi Flat (Bondi)");
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ action: "LAUNDRY_TEAM_REQUEST_SENT", entityId: "t1", after: { kind: "TEAM_PHOTO", supplierId: "s1", recipientIds: ["l1"], deliveryConfirmed: false } });
  });

  it("refuses when the partner has no portal users who may see the property, naming Chase supplier", async () => {
    m.users.mockResolvedValue([]);
    await expect(sendLaundryTeamRequest("ops-1", { laundryTaskId: "t1", kind: "TEAM_PHOTO", transports: ["PUSH"] })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Chase supplier") });
    // A team member who is not on the property's laundry team is not asked either.
    m.users.mockResolvedValue([tom]);
    m.task.mockResolvedValue({ ...deliveredWithoutPhoto, property: { ...property, accessInfo: { laundryTeamUserIds: ["someone-else"] } } });
    await expect(sendLaundryTeamRequest("ops-1", { laundryTaskId: "t1", kind: "TEAM_PHOTO", transports: ["PUSH"] })).rejects.toBeInstanceOf(OfficeActionError);
    expect(m.office).not.toHaveBeenCalled();
  });

  it("refuses a request that no longer applies, and a run without a supplier", async () => {
    await expect(sendLaundryTeamRequest("ops-1", { laundryTaskId: "t1", kind: "TEAM_CONFIRM_PICKUP", transports: ["PUSH"] })).rejects.toMatchObject({ status: 409 });
    m.task.mockResolvedValue({ ...deliveredWithoutPhoto, supplierId: null, supplier: null });
    await expect(sendLaundryTeamRequest("ops-1", { laundryTaskId: "t1", kind: "TEAM_PHOTO", transports: ["PUSH"] })).rejects.toMatchObject({ status: 409, message: "No laundry partner is recorded for this run." });
    expect(m.office).not.toHaveBeenCalled();
  });

  it("applies the cool-down per run and kind on its own audit action", async () => {
    m.recent.mockResolvedValue({ createdAt: new Date("2026-11-11T01:05:00Z"), after: { kind: "TEAM_PHOTO", idempotencyKey: "other" } });
    await expect(sendLaundryTeamRequest("ops-1", { laundryTaskId: "t1", kind: "TEAM_PHOTO", transports: ["PUSH"], idempotencyKey: "nudge:t1:TEAM_PHOTO:2" })).rejects.toMatchObject({ status: 409 });
    expect(m.recent.mock.calls[0][0].where).toMatchObject({ action: "LAUNDRY_TEAM_REQUEST_SENT", entityId: "t1", after: { path: ["kind"], equals: "TEAM_PHOTO" } });
  });
});

describe("LAUNDRY_TASK_SUPPLIER_TEAM scope (re-checked at dispatch)", () => {
  const recipient = { userId: "l1", role: "LAUNDRY" as const, scope: { kind: "ENTITY" as const, type: "LAUNDRY_TASK_SUPPLIER_TEAM", id: "t1" } };
  const reader = db as unknown as Parameters<typeof authorizeEntityRecipient>[0];

  it("allows an active laundry user of the run's supplier who may see the property", async () => {
    m.user.mockResolvedValue({ id: "l1", role: "LAUNDRY", isActive: true, clientId: null, laundrySupplierId: "s1" });
    m.task.mockResolvedValue({ supplierId: "s1", property: { accessInfo: null, laundryEnabled: true } });
    expect(await authorizeEntityRecipient(reader, recipient)).toEqual({ ok: true, role: "LAUNDRY" });
  });

  it("skips someone moved to another partner, a run whose supplier changed, a property hidden from them, or a disabled account", async () => {
    m.task.mockResolvedValue({ supplierId: "s1", property: { accessInfo: null, laundryEnabled: true } });
    m.user.mockResolvedValue({ id: "l1", role: "LAUNDRY", isActive: true, clientId: null, laundrySupplierId: "s2" });
    expect(await authorizeEntityRecipient(reader, recipient)).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
    m.user.mockResolvedValue({ id: "l1", role: "LAUNDRY", isActive: true, clientId: null, laundrySupplierId: "s1" });
    m.task.mockResolvedValue({ supplierId: "s2", property: { accessInfo: null, laundryEnabled: true } });
    expect(await authorizeEntityRecipient(reader, recipient)).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
    m.task.mockResolvedValue({ supplierId: "s1", property: { accessInfo: null, laundryEnabled: false } });
    expect(await authorizeEntityRecipient(reader, recipient)).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
    m.user.mockResolvedValue({ id: "l1", role: "LAUNDRY", isActive: false, clientId: null, laundrySupplierId: "s1" });
    expect(await authorizeEntityRecipient(reader, recipient)).toEqual({ ok: false, errorCode: "recipient_unavailable" });
  });
});
