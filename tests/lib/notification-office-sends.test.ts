// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  enqueue: vi.fn(), inline: vi.fn(), authorize: vi.fn(), email: vi.fn(), push: vi.fn(), notify: vi.fn(),
  subscriptions: vi.fn(), receipt: vi.fn(), receiptUpdate: vi.fn(), canDeliver: vi.fn(), settings: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  notification: { create: m.notify },
  appSetting: { create: m.receipt, update: m.receiptUpdate },
  $transaction: (run: (tx: unknown) => unknown) => run({ pushSubscription: { findMany: m.subscriptions } }),
} }));
vi.mock("@/lib/notifications/intent-store", () => ({ enqueueNotificationIntent: m.enqueue }));
vi.mock("@/lib/notifications/inline-dispatch", () => ({ deliverInboxIntentsNow: m.inline }));
vi.mock("@/lib/notifications/recipient-scopes", () => ({ authorizeEntityRecipient: m.authorize }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPushToUser: m.push }));
vi.mock("@/lib/notifications/preferences", () => ({ canDeliverNotification: m.canDeliver }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));

import { sendOfficeNotification, type OfficeSendInput } from "@/lib/notifications/office-sends";

const input = (overrides: Partial<OfficeSendInput> = {}): OfficeSendInput => ({
  typeKey: "job.reminder.manual", eventKey: "job.reminder.manual", eventId: "job-reminder:job-1:PUSH:key-12345",
  entity: { type: "Job", id: "job-1" }, actorId: "admin-1", scopeType: "JOB_ASSIGNED_CLEANER", scopeId: () => "job-1",
  category: "jobs", severity: "ACTION", jobId: "job-1", subject: "Unfinished job reminder", body: "Please submit.", url: "/cleaner/jobs",
  email: () => ({ subject: "Reminder", html: "<p>Reminder</p>" }), emailKind: "job_reminder",
  transports: ["PUSH"], recipients: [{ id: "cleaner-1", role: "CLEANER", name: "Ana", email: "ana@example.invalid" }],
  respectsPreferences: false, disabledTransports: [], ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS", "");
  let counter = 0;
  m.enqueue.mockImplementation(() => Promise.resolve({ id: `i${++counter}` }));
  m.inline.mockImplementation((ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, { state: "inbox_available", notificationId: `intent-${id}` }]))));
  m.authorize.mockResolvedValue({ ok: true, role: "CLEANER" });
  m.subscriptions.mockResolvedValue([{ id: "sub-1" }, { id: "sub-2" }]);
  m.email.mockResolvedValue({ ok: true, externalId: "resend-1" });
  m.push.mockResolvedValue(undefined);
  m.receipt.mockResolvedValue({});
  m.receiptUpdate.mockResolvedValue({});
  m.canDeliver.mockResolvedValue(true);
  m.settings.mockResolvedValue({ notificationAudienceControls: undefined });
});
afterEach(() => vi.unstubAllEnvs());

describe("push reminders with the outbox transports switched off (production default)", () => {
  it("queues the inbox row on the pipeline with the phone-push marker and keeps the browser push direct", async () => {
    const outcomes = await sendOfficeNotification(input());
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.enqueue.mock.calls[0][1]).toMatchObject({
      transport: "INBOX", mobilePushCategory: "jobs", recipientPreferences: "IGNORE",
      recipient: { userId: "cleaner-1", role: "CLEANER", scope: { kind: "ENTITY", type: "JOB_ASSIGNED_CLEANER", id: "job-1" } },
    });
    expect(m.inline).toHaveBeenCalledWith(["i1"]);
    expect(m.push).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ transport: "INBOX", path: "pipeline", state: "inbox_available" }),
      expect.objectContaining({ transport: "MOBILE_PUSH", path: "pipeline", state: "queued" }),
      expect.objectContaining({ transport: "WEB_PUSH", path: "direct", state: "requested" }),
    ]));
    expect(outcomes.some((outcome) => (outcome.state as string) === "delivered" || (outcome.state as string) === "sent")).toBe(false);
  });

  it("reports an inbox intent the worker still has to deliver as queued, not available", async () => {
    m.inline.mockResolvedValue(new Map([["i1", { state: "queued", errorCode: null }]]));
    const outcomes = await sendOfficeNotification(input());
    expect(outcomes.find((outcome) => outcome.transport === "INBOX")).toMatchObject({ state: "queued" });
  });
});

describe("transports on the pipeline when the outbox switch is on", () => {
  it("queues one browser push intent per device and sends nothing directly", async () => {
    vi.stubEnv("SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS", "WEB_PUSH,EMAIL");
    const outcomes = await sendOfficeNotification(input());
    expect(m.enqueue.mock.calls.map((call) => call[1].transport)).toEqual(["INBOX", "WEB_PUSH", "WEB_PUSH"]);
    expect(m.push).not.toHaveBeenCalled();
    expect(outcomes.find((outcome) => outcome.transport === "WEB_PUSH")).toMatchObject({ path: "pipeline", state: "queued" });
  });

  it("queues email on the pipeline and never calls the provider inline", async () => {
    vi.stubEnv("SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS", "EMAIL");
    const outcomes = await sendOfficeNotification(input({ transports: ["EMAIL"] }));
    expect(m.enqueue.mock.calls[0][1]).toMatchObject({ transport: "EMAIL", emailKind: "job_reminder", emailHtml: "<p>Reminder</p>" });
    expect(m.email).not.toHaveBeenCalled();
    expect(outcomes).toEqual([expect.objectContaining({ transport: "EMAIL", path: "pipeline", state: "queued" })]);
  });
});

describe("email with the outbox email transport off falls back to the direct send", () => {
  it("sends directly, records the row and says provider accepted (not delivered)", async () => {
    const outcomes = await sendOfficeNotification(input({ transports: ["EMAIL"] }));
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ kind: "job_reminder", to: "ana@example.invalid" }));
    expect(m.notify.mock.calls[0][0].data).toMatchObject({ channel: "EMAIL", status: "SENT", externalId: "resend-1", deliveryStatus: "PENDING" });
    expect(outcomes).toEqual([expect.objectContaining({ transport: "EMAIL", path: "direct", state: "provider_accepted" })]);
  });

  it("does not send the same direct email twice for a retried request", async () => {
    m.receipt.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "P2002" }));
    const outcomes = await sendOfficeNotification(input({ transports: ["EMAIL"] }));
    expect(m.email).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ state: "already_requested" });
  });

  it("fails a cleaner with no email address without calling the provider", async () => {
    const outcomes = await sendOfficeNotification(input({ transports: ["EMAIL"], recipients: [{ id: "cleaner-1", role: "CLEANER", name: "Ana", email: null }] }));
    expect(m.email).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ state: "failed", errorCode: "missing_email" });
  });
});

describe("recipient authorization and switches", () => {
  it("queues and sends nothing for a recipient who is no longer assigned or active", async () => {
    m.authorize.mockResolvedValue({ ok: false, errorCode: "recipient_not_in_scope" });
    const outcomes = await sendOfficeNotification(input({ transports: ["PUSH", "EMAIL"] }));
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
    expect(m.email).not.toHaveBeenCalled();
    expect(outcomes.every((outcome) => outcome.state === "skipped" && outcome.errorCode === "recipient_not_in_scope")).toBe(true);
  });

  it("sends nothing on a transport switched off for the type", async () => {
    const outcomes = await sendOfficeNotification(input({ disabledTransports: ["WEB_PUSH", "MOBILE_PUSH"] }));
    expect(m.push).not.toHaveBeenCalled();
    expect(m.enqueue.mock.calls[0][1]).not.toHaveProperty("mobilePushCategory");
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ transport: "WEB_PUSH", state: "switched_off" }),
      expect.objectContaining({ transport: "MOBILE_PUSH", state: "switched_off" }),
    ]));
  });

  it("applies personal preferences only when the type's switch says so", async () => {
    m.canDeliver.mockResolvedValue(false);
    const ignored = await sendOfficeNotification(input({ transports: ["EMAIL"] }));
    expect(ignored[0]).toMatchObject({ state: "provider_accepted" });
    expect(m.canDeliver).not.toHaveBeenCalled();
    m.email.mockClear();
    const respected = await sendOfficeNotification(input({ transports: ["EMAIL"], respectsPreferences: true }));
    expect(respected[0]).toMatchObject({ state: "skipped", errorCode: "recipient_preference" });
    expect(m.email).not.toHaveBeenCalled();
    await sendOfficeNotification(input({ respectsPreferences: true }));
    expect(m.enqueue.mock.calls.at(-1)![1]).not.toHaveProperty("recipientPreferences");
  });
});

describe("Wave F: an inbox-only send", () => {
  it("queues the inbox row alone: no phone-push marker, no browser push, no email", async () => {
    const outcomes = await sendOfficeNotification(input({ transports: ["INBOX"] }));
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.enqueue.mock.calls[0][1]).toMatchObject({ transport: "INBOX" });
    expect(m.enqueue.mock.calls[0][1]).not.toHaveProperty("mobilePushCategory");
    expect(m.push).not.toHaveBeenCalled();
    expect(m.email).not.toHaveBeenCalled();
    expect(outcomes).toEqual([expect.objectContaining({ transport: "INBOX", path: "pipeline", state: "inbox_available" })]);
  });

  it("reports a refused recipient on the inbox, not as an email", async () => {
    m.authorize.mockResolvedValue({ ok: false, errorCode: "recipient_not_in_scope" });
    const outcomes = await sendOfficeNotification(input({ transports: ["INBOX"] }));
    expect(outcomes).toEqual([expect.objectContaining({ transport: "INBOX", state: "skipped", errorCode: "recipient_not_in_scope" })]);
  });
});
