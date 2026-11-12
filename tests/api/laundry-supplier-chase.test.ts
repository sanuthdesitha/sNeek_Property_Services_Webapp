// @vitest-environment node
// Wave E: "Chase supplier" on a laundry run beyond the supplier's turnaround.
// Administrators, and (owner decision 2026-11-12) operations managers with the
// Laundry pack at manage, send to the supplier's STORED contact only (email / SMS
// through the shared external-recipient path); everyone who can open the run
// gets the draft; disabled with the reason; a cool-down per run; audit rows
// carry a masked address; no real message leaves (providers mocked).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  session: vi.fn(), task: vi.fn(), auditFind: vi.fn(), auditCount: vi.fn(), auditCreate: vi.fn(), notify: vi.fn(), receipt: vi.fn(),
  email: vi.fn(), sms: vi.fn(), smsState: vi.fn(), settings: vi.fn(), ops: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms, getSmsProviderState: m.smsState }));
vi.mock("@/lib/db", () => ({ db: {
  laundryTask: { findUnique: m.task },
  auditLog: { findMany: m.auditFind, count: m.auditCount, create: m.auditCreate },
  notification: { create: m.notify },
  appSetting: { create: m.receipt, update: vi.fn().mockResolvedValue({}) },
} }));

import { GET as PREVIEW } from "@/app/api/admin/laundry/[taskId]/supplier-chase/route";
import { POST as SEND } from "@/app/api/admin/notifications/actions/supplier-chase/route";
import { draftSupplierChase, supplierChaseBlockedReason, supplierChaseKey } from "@/lib/laundry/supplier-chase-rules";

const NOW = Date.now();
const pickedUp = new Date(NOW - 72 * 3_600_000);
const run = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1", jobId: "job-1", status: "PICKED_UP", pickupDate: pickedUp, dropoffDate: new Date(NOW + 86_400_000), pickedUpAt: pickedUp, droppedAt: null, flagReason: null,
  supplier: { id: "sup-1", name: "Fresh Linen", email: "orders@fresh.invalid", phone: "+61 400 000 123", avgTurnaround: 24 },
  property: { name: "Bondi Studio", suburb: "Bondi" },
  confirmations: [{ laundryReady: true, photoUrl: null, notes: JSON.stringify({ bagCount: 3 }), createdAt: pickedUp }],
  ...overrides,
});
const admin = { user: { id: "admin-1", role: Role.ADMIN } };
const ops = { user: { id: "ops-1", role: Role.OPS_MANAGER } };
const get = () => PREVIEW(new Request("http://localhost/x") as never, { params: { taskId: "task-1" } });
const post = (body: Record<string, unknown>) => SEND(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }));
const sendBody = (overrides: Record<string, unknown> = {}) => ({ laundryTaskId: "task-1", transports: ["EMAIL"], subject: "Laundry for Bondi Studio", body: "Please confirm.", idempotencyKey: "chase:task-1:42", ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RESEND_API_KEY", "test-key");
  m.session.mockResolvedValue(admin);
  m.task.mockResolvedValue(run());
  m.auditFind.mockResolvedValue([]);
  m.auditCount.mockResolvedValue(0);
  m.receipt.mockResolvedValue({});
  m.settings.mockResolvedValue({ companyName: "sNeek", companyPhone: "02 9000 0000", timezone: "Australia/Sydney", laundryOperations: { maxOutdoorDays: 3 }, laundryPortalVisibility: {} });
  m.smsState.mockResolvedValue({ provider: "twilio", configured: true });
  m.email.mockResolvedValue({ ok: true, externalId: "resend-1" });
  m.sms.mockResolvedValue({ ok: true, status: "sent" });
});

describe("rules and draft", () => {
  it("applies only to a picked-up run over turnaround with a supplier", () => {
    const over = [{ code: "OVER_TURNAROUND" as const, label: "Over" }];
    expect(supplierChaseBlockedReason({ status: "PICKED_UP", hasSupplier: true, exceptions: over })).toBeNull();
    expect(supplierChaseBlockedReason({ status: "PICKED_UP", hasSupplier: false, exceptions: over })).toMatch(/No supplier/);
    expect(supplierChaseBlockedReason({ status: "DROPPED", hasSupplier: true, exceptions: over })).toMatch(/not at the laundry/);
    expect(supplierChaseBlockedReason({ status: "PICKED_UP", hasSupplier: true, exceptions: [] })).toMatch(/within/);
  });
  it("drafts property, bags and days, and keys one request per run and window", () => {
    const draft = draftSupplierChase({ supplierName: "Fresh", propertyName: "Bondi Studio", propertySuburb: "Bondi", bagCount: 3, daysAtLaundry: 3, pickedUpLabel: "Mon 9 Nov", turnaroundHours: 24, officeName: "sNeek", officePhone: null });
    expect(draft.body).toContain("Bondi Studio (Bondi): 3 bags, picked up Mon 9 Nov, now 3 days with you. Your usual turnaround is 24 hours.");
    expect(supplierChaseKey("task-1", 0)).toBe(supplierChaseKey("task-1", 29 * 60_000));
    expect(supplierChaseKey("task-1", 0)).not.toBe(supplierChaseKey("task-1", 31 * 60_000));
  });
});

describe("preview", () => {
  it("gives the draft and stored contact to an operations manager without the Laundry pack at manage, without the right to send", async () => {
    m.session.mockResolvedValue(ops);
    m.ops.mockResolvedValue({ laundry: "read" });
    const body = await (await get()).json();
    expect(body).toMatchObject({ blockedReason: null, canSend: false, supplier: { email: "orders@fresh.invalid" }, transports: { EMAIL: { available: true }, SMS: { available: true } } });
    expect(body.sendNote).toMatch(/Laundry permission/);
    expect(body.draft.body).toContain("3 bags");
    expect(m.session).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });
  it("offers Send to an operations manager with the Laundry pack at manage, not while impersonating", async () => {
    m.session.mockResolvedValue(ops);
    m.ops.mockResolvedValue({ laundry: "manage" });
    expect((await (await get()).json()).canSend).toBe(true);
    m.session.mockResolvedValue({ ...admin, impersonation: { actorId: "owner" } });
    const impersonated = await (await get()).json();
    expect(impersonated.canSend).toBe(false);
    expect(impersonated.sendNote).toMatch(/impersonating/);
  });
  it("disables each transport with its reason (no contact, provider not configured)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    m.task.mockResolvedValue(run({ supplier: { id: "sup-1", name: "Fresh", email: "orders@fresh.invalid", phone: null, avgTurnaround: 24 } }));
    const body = await (await get()).json();
    expect(body.transports.EMAIL).toEqual({ available: false, reason: expect.stringMatching(/not configured/) });
    expect(body.transports.SMS).toEqual({ available: false, reason: expect.stringMatching(/no phone number/) });
  });
  it("says why it does not apply to a run within turnaround", async () => {
    m.task.mockResolvedValue(run({ pickedUpAt: new Date(NOW - 2 * 3_600_000) }));
    expect((await (await get()).json()).blockedReason).toMatch(/within/);
  });
});

describe("send", () => {
  it("is refused to an operations manager without the Laundry pack at manage, to a revoked account and while impersonating", async () => {
    m.session.mockResolvedValueOnce(ops);
    m.ops.mockResolvedValueOnce({ laundry: "read" });
    const refused = await post(sendBody());
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toMatch(/Laundry permission/);
    expect(m.session).toHaveBeenLastCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    m.session.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await post(sendBody())).status).toBe(401);
    m.session.mockResolvedValueOnce({ ...admin, impersonation: { actorId: "owner" } });
    expect((await post(sendBody())).status).toBe(403);
    expect(m.email).not.toHaveBeenCalled();
  });

  it("lets an operations manager with the Laundry pack at manage send, with the same limits and a masked audit row naming the actor and role", async () => {
    m.session.mockResolvedValue(ops);
    m.ops.mockResolvedValue({ laundry: "manage" });
    const response = await post(sendBody());
    expect(response.status).toBe(200);
    const audit = m.auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ userId: "ops-1", action: "LAUNDRY_SUPPLIER_CHASE_SENT", after: { actorRole: "OPS_MANAGER", to: "o***@fresh.invalid" } });
    // The same per-sender and per-run limits are counted for the manager.
    expect(m.auditCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "ops-1" }) }));
  });

  it("sends to the stored address only, records the provider's answer and audits a masked address", async () => {
    const response = await post(sendBody({ transports: ["EMAIL", "SMS"] }));
    expect(response.status).toBe(200);
    expect((await response.json()).outcomes).toEqual([
      { transport: "EMAIL", state: "provider_accepted", errorCode: null, to: "o***@fresh.invalid" },
      { transport: "SMS", state: "provider_accepted", errorCode: null, to: "***123" },
    ]);
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: "orders@fresh.invalid" }));
    expect(m.sms).toHaveBeenCalledWith("+61 400 000 123", "Please confirm.");
    const audits = m.auditCreate.mock.calls.map((call) => call[0].data);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ action: "LAUNDRY_SUPPLIER_CHASE_SENT", entity: "LaundryTask", entityId: "task-1", after: { to: "o***@fresh.invalid", chaseKey: "chase:task-1:42", deliveryConfirmed: false } });
    expect(JSON.stringify(audits)).not.toContain("orders@fresh.invalid");
  });

  it("refuses an address in the body (strict schema) and a transport that is not available", async () => {
    expect((await post({ ...sendBody(), to: "attacker@example.invalid" })).status).toBe(400);
    m.task.mockResolvedValue(run({ supplier: { id: "sup-1", name: "Fresh", email: null, phone: null, avgTurnaround: 24 } }));
    const refused = await post(sendBody());
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/no email address/);
    expect(m.email).not.toHaveBeenCalled();
  });

  it("keeps a cool-down per run, letting a retry of the same request through", async () => {
    m.auditFind.mockResolvedValue([{ createdAt: new Date(NOW - 5 * 60_000), after: { state: "provider_accepted", chaseKey: "chase:task-1:41" } }]);
    const refused = await post(sendBody());
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/already chased at/);
    m.auditFind.mockResolvedValue([{ createdAt: new Date(NOW - 5 * 60_000), after: { state: "provider_accepted", chaseKey: "chase:task-1:42" } }]);
    expect((await post(sendBody())).status).toBe(200);
  });

  it("does not start the cool-down after a failed send, and reports not configured truthfully", async () => {
    m.auditFind.mockResolvedValue([{ createdAt: new Date(NOW - 5 * 60_000), after: { state: "failed", chaseKey: "chase:task-1:41" } }]);
    m.email.mockResolvedValue({ ok: false, error: "RESEND_API_KEY is not configured" });
    const body = await (await post(sendBody())).json();
    expect(body.outcomes[0]).toMatchObject({ state: "failed", errorCode: "email_rejected" });
    expect(m.notify.mock.calls[0][0].data).toMatchObject({ status: "FAILED", channel: "EMAIL" });
  });

  it("refuses a run that is no longer over turnaround (re-checked on the server)", async () => {
    m.task.mockResolvedValue(run({ status: "DROPPED", droppedAt: new Date() }));
    expect((await post(sendBody())).status).toBe(409);
    expect(m.email).not.toHaveBeenCalled();
  });
});
