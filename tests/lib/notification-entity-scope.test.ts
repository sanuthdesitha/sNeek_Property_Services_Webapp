// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(), assignment: vi.fn(), job: vi.fn(), task: vi.fn(), intent: vi.fn(), intentUpdate: vi.fn(), attemptUpdate: vi.fn(),
  create: vi.fn(), eventPreference: vi.fn(), canDeliver: vi.fn(), settings: vi.fn(), email: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const client = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: { findUnique: m.user }, jobAssignment: { findFirst: m.assignment }, job: { findUnique: m.job }, laundryTask: { findUnique: m.task },
    notificationIntent: { findUnique: m.intent, update: m.intentUpdate }, notificationAttempt: { update: m.attemptUpdate },
    notificationPreference: { findUnique: m.eventPreference }, notification: { create: m.create },
  };
  return { db: { ...client, $transaction: (run: (tx: typeof client) => unknown) => run(client) } };
});
vi.mock("@/lib/notifications/preferences", () => ({ canDeliverNotification: m.canDeliver }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: vi.fn() }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPush: vi.fn() }));

import { deliverInboxIntent } from "@/lib/notifications/intent-store";
import { deliverProviderIntent } from "@/lib/notifications/intent-provider";
import { notificationEnvelopeHash, notificationEnvelopeSchema } from "@/lib/notifications/intent-contract";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";
import { markMobileOutboxRows, mobilePendingMarker } from "@/lib/notifications/mobile-outbox-marker";
import { db } from "@/lib/db";

const envelope = (overrides: Record<string, unknown> = {}) => notificationEnvelopeSchema.parse({
  version: 1, eventId: "job-reminder:job-1:PUSH:key", eventKey: "job.reminder.manual", entity: { type: "Job", id: "job-1" }, actorId: "admin-1",
  recipient: { userId: "cleaner-1", role: "CLEANER", scope: { kind: "ENTITY", type: "JOB_ASSIGNED_CLEANER", id: "job-1" } },
  severity: "ACTION", category: "jobs", transport: "INBOX", subject: "Unfinished job reminder", body: "Please submit.", jobId: "job-1",
  mobilePushCategory: "jobs", recipientPreferences: "IGNORE", ...overrides,
});
function stageIntent(value: ReturnType<typeof envelope>) {
  m.intent.mockResolvedValue({ id: "intent-1", status: "PROCESSING", leaseToken: "lease", attemptCount: 1, transport: value.transport, envelope: value, envelopeHash: notificationEnvelopeHash(value) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS", "EMAIL");
  m.user.mockResolvedValue({ id: "cleaner-1", role: "CLEANER", isActive: true, clientId: null, email: "ana@example.invalid", phone: null });
  m.assignment.mockResolvedValue({ id: "assignment-1" });
  m.create.mockImplementation(({ data }: { data: { id: string } }) => Promise.resolve({ id: data.id }));
  m.intentUpdate.mockResolvedValue({});
  m.attemptUpdate.mockResolvedValue({});
  m.canDeliver.mockResolvedValue(true);
  m.settings.mockResolvedValue({});
  m.email.mockResolvedValue({ ok: true, externalId: "resend-1" });
});

describe("inbox delivery for the assigned-cleaner scope", () => {
  it("creates the row the phone app and inbox read: PUSH, SENT, with the mobile outbox marker", async () => {
    stageIntent(envelope());
    await deliverInboxIntent("intent-1", "lease");
    const row = m.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ id: "intent-intent-1", userId: "cleaner-1", jobId: "job-1", channel: "PUSH", status: "SENT", externalId: mobilePendingMarker("jobs") });
    // The DB middleware leaves an explicit pipeline marker alone, so the mobile outbox picks it up.
    expect(markMobileOutboxRows(row)).toEqual(row);
    expect(m.intentUpdate.mock.calls[0][0].data).toMatchObject({ status: "ACCEPTED" });
    expect(m.canDeliver).not.toHaveBeenCalled();
  });

  it("adds no phone push when the producer did not declare one", async () => {
    const value = envelope();
    delete (value as { mobilePushCategory?: string }).mobilePushCategory;
    stageIntent(value);
    await deliverInboxIntent("intent-1", "lease");
    expect(m.create.mock.calls[0][0].data).not.toHaveProperty("externalId");
  });

  it("skips a cleaner whose assignment was removed after queueing", async () => {
    m.assignment.mockResolvedValue(null);
    stageIntent(envelope());
    await deliverInboxIntent("intent-1", "lease");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.intentUpdate.mock.calls[0][0].data).toMatchObject({ status: "SKIPPED", lastErrorCode: "recipient_not_in_scope" });
  });

  it("skips a deactivated cleaner and a role change", async () => {
    m.user.mockResolvedValue({ id: "cleaner-1", role: "CLEANER", isActive: false });
    stageIntent(envelope());
    await deliverInboxIntent("intent-1", "lease");
    m.user.mockResolvedValue({ id: "cleaner-1", role: "CLIENT", isActive: true });
    await deliverInboxIntent("intent-1", "lease");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.intentUpdate.mock.calls.map((call) => call[0].data.lastErrorCode)).toEqual(["recipient_unavailable", "recipient_unavailable"]);
  });

  it("still refuses unknown entity scopes", async () => {
    stageIntent(envelope({ recipient: { userId: "cleaner-1", role: "CLEANER", scope: { kind: "ENTITY", type: "Job", id: "job-1" } } }));
    await deliverInboxIntent("intent-1", "lease");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.intentUpdate.mock.calls[0][0].data).toMatchObject({ status: "SKIPPED", lastErrorCode: "unsupported_recipient_scope" });
  });

  it("applies preferences when the envelope does not say IGNORE", async () => {
    m.canDeliver.mockResolvedValue(false);
    const value = envelope();
    delete (value as { recipientPreferences?: string }).recipientPreferences;
    stageIntent(value);
    await deliverInboxIntent("intent-1", "lease");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.intentUpdate.mock.calls[0][0].data).toMatchObject({ status: "SKIPPED", lastErrorCode: "recipient_preference" });
  });
});

describe("provider delivery for the assigned-cleaner scope", () => {
  const email = () => envelope({ transport: "EMAIL", emailHtml: "<p>Reminder</p>", emailKind: "job_reminder", mobilePushCategory: undefined });
  it("re-checks the assignment at send time before calling the provider", async () => {
    expect(await deliverProviderIntent(email())).toEqual({ kind: "ACCEPTED", providerReference: "resend-1" });
    m.assignment.mockResolvedValue(null);
    expect(await deliverProviderIntent(email())).toEqual({ kind: "SKIPPED", errorCode: "recipient_not_in_scope" });
    expect(m.email).toHaveBeenCalledTimes(1);
  });
  it("sends nothing when the outbox email transport is off", async () => {
    vi.stubEnv("SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS", "");
    expect(await deliverProviderIntent(email())).toEqual({ kind: "SKIPPED", errorCode: "transport_not_enabled" });
    expect(m.email).not.toHaveBeenCalled();
  });
});

describe("recipient scope rules", () => {
  const recipient = (type: string, id: string, role = "CLEANER") => ({ userId: "u1", role: role as "CLEANER", scope: { kind: "ENTITY" as const, type, id } });
  it("staff messages reach staff by name only, never clients", async () => {
    m.user.mockResolvedValue({ id: "u1", role: "CLEANER", isActive: true, clientId: null });
    expect(await authorizeEntityRecipient(db, recipient("STAFF_MEMBER", "u1"))).toMatchObject({ ok: true });
    expect(await authorizeEntityRecipient(db, recipient("STAFF_MEMBER", "someone-else"))).toMatchObject({ ok: false });
    m.user.mockResolvedValue({ id: "u1", role: "CLIENT", isActive: true, clientId: "c1" });
    expect(await authorizeEntityRecipient(db, recipient("STAFF_MEMBER", "u1", "CLIENT"))).toMatchObject({ ok: false, errorCode: "recipient_not_in_scope" });
  });
  it("client contacts must belong to the job's client", async () => {
    m.user.mockResolvedValue({ id: "u1", role: "CLIENT", isActive: true, clientId: "c1" });
    m.job.mockResolvedValue({ property: { clientId: "c1" } });
    expect(await authorizeEntityRecipient(db, recipient("JOB_CLIENT_CONTACT", "job-1", "CLIENT"))).toMatchObject({ ok: true });
    m.job.mockResolvedValue({ property: { clientId: "c2" } });
    expect(await authorizeEntityRecipient(db, recipient("JOB_CLIENT_CONTACT", "job-1", "CLIENT"))).toMatchObject({ ok: false });
  });
  it("laundry nudges reach only the cleaners assigned to the task's job", async () => {
    m.task.mockResolvedValue({ jobId: "job-9" });
    expect(await authorizeEntityRecipient(db, recipient("LAUNDRY_TASK_CLEANER", "task-1"))).toMatchObject({ ok: true });
    expect(m.assignment).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "job-9", userId: "cleaner-1", removedAt: null } }));
    m.task.mockResolvedValue(null);
    expect(await authorizeEntityRecipient(db, recipient("LAUNDRY_TASK_CLEANER", "missing"))).toMatchObject({ ok: false });
  });
});

describe("Wave F: URGENT_STOCK_PURCHASE_ASK scope", () => {
  const recipient = { userId: "cleaner-1", role: "CLEANER" as const, scope: { kind: "ENTITY" as const, type: "URGENT_STOCK_PURCHASE_ASK", id: "ask-1" } };
  const reader = (ask: { cleanerId: string; state: string } | null) => ({
    user: { findUnique: async () => ({ id: "cleaner-1", role: "CLEANER", isActive: true, clientId: null }) },
    jobAssignment: { findFirst: async () => null }, laundryTask: { findUnique: async () => null }, job: { findUnique: async () => null },
    urgentStockPurchaseAsk: { findUnique: async () => ask },
  }) as never;
  it("delivers only to the asked cleaner while the ask is still waiting", async () => {
    expect(await authorizeEntityRecipient(reader({ cleanerId: "cleaner-1", state: "ASKED" }), recipient)).toEqual({ ok: true, role: "CLEANER" });
    expect(await authorizeEntityRecipient(reader({ cleanerId: "cleaner-1", state: "WITHDRAWN" }), recipient)).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
    expect(await authorizeEntityRecipient(reader({ cleanerId: "someone-else", state: "ASKED" }), recipient)).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
    expect(await authorizeEntityRecipient(reader(null), recipient)).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
  });
});

describe("URGENT_STOCK_OFFICE scope (owner decision 2026-11-12)", () => {
  const office = (userId: string, role: "ADMIN" | "OPS_MANAGER") => ({ userId, role, scope: { kind: "ENTITY" as const, type: "URGENT_STOCK_OFFICE", id: "need-1" } });
  function reader(user: Record<string, unknown>, extraRoles: string[], policy: unknown) {
    return {
      user: { findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) => (select.extraRoles ? { extraRoles: extraRoles.map((role) => ({ role })) } : user)) },
      appSetting: { findUnique: vi.fn(async () => (policy === undefined ? null : { value: policy })) },
      jobAssignment: { findFirst: vi.fn() }, laundryTask: { findUnique: vi.fn() }, job: { findUnique: vi.fn() },
    } as never;
  }
  const policy = (inventory: string) => ({ revision: 1, presets: [], assignments: { "ops-1": { presetId: "existing", overrides: { inventory } } } });
  const ops = { id: "ops-1", role: "OPS_MANAGER", isActive: true, clientId: null };

  it("admits an active ADMIN and a manager whose inventory pack is read or manage", async () => {
    expect(await authorizeEntityRecipient(reader({ id: "a", role: "ADMIN", isActive: true, clientId: null }, [], undefined), office("a", "ADMIN"))).toEqual({ ok: true, role: "ADMIN" });
    expect(await authorizeEntityRecipient(reader(ops, [], policy("read")), office("ops-1", "OPS_MANAGER"))).toEqual({ ok: true, role: "OPS_MANAGER" });
    expect(await authorizeEntityRecipient(reader(ops, [], policy("manage")), office("ops-1", "OPS_MANAGER"))).toEqual({ ok: true, role: "OPS_MANAGER" });
  });
  it("refuses a manager with the pack off, fails closed on a corrupt policy, and lets a manager who also holds ADMIN through", async () => {
    expect(await authorizeEntityRecipient(reader(ops, [], policy("off")), office("ops-1", "OPS_MANAGER"))).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
    expect(await authorizeEntityRecipient(reader(ops, [], { revision: "broken" }), office("ops-1", "OPS_MANAGER"))).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
    expect(await authorizeEntityRecipient(reader(ops, ["ADMIN"], policy("off")), office("ops-1", "OPS_MANAGER"))).toEqual({ ok: true, role: "OPS_MANAGER" });
  });
  it("refuses a cleaner and an inactive or re-roled account", async () => {
    expect(await authorizeEntityRecipient(reader({ id: "c", role: "CLEANER", isActive: true, clientId: null }, [], undefined), { ...office("c", "ADMIN"), role: "CLEANER" } as never)).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
    expect(await authorizeEntityRecipient(reader({ ...ops, isActive: false }, [], policy("manage")), office("ops-1", "OPS_MANAGER"))).toEqual({ ok: false, errorCode: "recipient_unavailable" });
    expect(await authorizeEntityRecipient(reader({ ...ops, role: "CLEANER" }, [], policy("manage")), office("ops-1", "OPS_MANAGER"))).toEqual({ ok: false, errorCode: "recipient_unavailable" });
  });
});
