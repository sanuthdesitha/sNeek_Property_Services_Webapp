// @vitest-environment node
/**
 * Owner decision 2026-11-13: "Message team" on a job sends ONLY to the
 * cleaners assigned now (scope JOB_ASSIGNED_CLEANER, re-checked at queue, at
 * dispatch and right before an SMS), by the transports the office chose, with
 * truthful accepted / skipped / failed per person and transport, one send per
 * request key, limits like the other office sends, audited on the job, and
 * wording from the wording layer (the office's text is the body).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  job: vi.fn(), auditFind: vi.fn(), auditCount: vi.fn(), auditCreate: vi.fn(), notification: vi.fn(), setting: vi.fn(),
  office: vi.fn(), scope: vi.fn(), sms: vi.fn(), providers: vi.fn(), savePref: vi.fn(), readPref: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {
  job: { findUnique: m.job }, auditLog: { findFirst: m.auditFind, count: m.auditCount, create: m.auditCreate },
  notification: { create: m.notification }, appSetting: { findUnique: m.setting },
} }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office }));
vi.mock("@/lib/notifications/recipient-scopes", () => ({ authorizeEntityRecipient: m.scope }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/notifications/external-recipient", () => ({ externalTransportAvailability: m.providers }));
vi.mock("@/lib/notifications/dispatch-once", () => ({ dispatchNotificationOnce: async (_key: unknown, work: () => Promise<void>) => { await work(); return true; } }));
vi.mock("@/lib/notifications/send-transport-preference", () => ({ saveTransportChoice: m.savePref, readSendTransportPreferences: m.readPref }));

import { previewJobOfficeMessage, sendJobOfficeMessage } from "@/lib/notifications/job-office-message";
import { OfficeActionError } from "@/lib/notifications/office-actions";
import { defaultNotificationWording } from "@/lib/notifications/wording/render";
import { wordingDefinition } from "@/lib/notifications/wording/registry";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import { jobMessageTransportOptions, normalizeJobTransports, outcomeState } from "@/lib/notifications/job-office-message-rules";

const job = {
  id: "j1", jobNumber: "J-7", property: { name: "Bondi Flat" },
  assignments: [
    { user: { id: "c1", role: "CLEANER", name: "Mia", email: "mia@x.invalid", phone: "+61400000001" } },
    { user: { id: "c2", role: "CLEANER", name: "Ben", email: null, phone: null } },
  ],
};
let actorSeq = 0;
const actor = () => ({ id: `admin-${++actorSeq}`, role: "ADMIN" as const });
const input = (overrides: Record<string, unknown> = {}) => ({ recipientIds: ["c1", "c2"], body: "Gate code changed, see notes.", transports: ["INBOX"], idempotencyKey: `key-${actorSeq}-abcdef`, ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
  m.job.mockResolvedValue(job);
  m.auditFind.mockResolvedValue(null);
  m.auditCount.mockResolvedValue(0);
  m.setting.mockResolvedValue(null);
  m.scope.mockResolvedValue({ ok: true, role: "CLEANER" });
  m.providers.mockResolvedValue({ EMAIL: { available: true, reason: null }, SMS: { available: true, reason: null } });
  m.sms.mockResolvedValue({ ok: true, status: "sent", provider: "twilio" });
  m.readPref.mockResolvedValue({ readable: true, kinds: {} });
  m.office.mockImplementation(async ({ recipients }: { recipients: Array<{ id: string; name: string }> }) =>
    recipients.map((recipient) => ({ userId: recipient.id, name: recipient.name, transport: "INBOX", path: "pipeline", state: "inbox_available", errorCode: null })));
});

describe("recipients", () => {
  it("addresses only the assigned cleaners through the job scope, with the office text as the body", async () => {
    const result = await sendJobOfficeMessage(actor(), "j1", input());
    const call = m.office.mock.calls[0][0];
    expect(call).toMatchObject({ typeKey: "job.office_message", scopeType: "JOB_ASSIGNED_CLEANER", transports: ["INBOX"], jobId: "j1", body: "Gate code changed, see notes.", subject: "Message from the office: J-7 at Bondi Flat" });
    expect(call.scopeId()).toBe("j1");
    expect(call.recipients.map((r: { id: string }) => r.id)).toEqual(["c1", "c2"]);
    expect(result.outcomes.map((o) => [o.userId, o.transport, o.state])).toEqual([["c1", "INBOX", "accepted"], ["c2", "INBOX", "accepted"]]);
  });

  it("leaves out removed names and refuses anyone not assigned (no free recipients)", async () => {
    const result = await sendJobOfficeMessage(actor(), "j1", input({ recipientIds: ["c1", "stranger"] }));
    expect(m.office.mock.calls[0][0].recipients.map((r: { id: string }) => r.id)).toEqual(["c1"]);
    expect(result.refused).toEqual([{ id: "stranger", reason: expect.stringContaining("Not assigned") }]);
  });

  it("refuses an unassigned job and a request naming nobody on it", async () => {
    m.job.mockResolvedValue({ ...job, assignments: [] });
    await expect(sendJobOfficeMessage(actor(), "j1", input())).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Nobody is assigned") });
    m.job.mockResolvedValue(job);
    await expect(sendJobOfficeMessage(actor(), "j1", input({ recipientIds: ["x"] }))).rejects.toBeInstanceOf(OfficeActionError);
    expect(m.office).not.toHaveBeenCalled();
  });

  it("re-checks the scope right before an SMS: a cleaner removed meanwhile is skipped, no phone is skipped", async () => {
    m.scope.mockImplementation(async (_reader: unknown, { userId }: { userId: string }) => (userId === "c1" ? { ok: false, errorCode: "recipient_not_in_scope" } : { ok: true, role: "CLEANER" }));
    const result = await sendJobOfficeMessage(actor(), "j1", input({ transports: ["SMS"] }));
    expect(m.office).not.toHaveBeenCalled();
    expect(m.sms).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      { userId: "c1", name: "Mia", transport: "SMS", state: "skipped", reason: "No longer assigned to this job." },
      { userId: "c2", name: "Ben", transport: "SMS", state: "skipped", reason: "No phone number recorded." },
    ]);
  });
});

describe("transports and states", () => {
  it("are explicit: none is refused; Push includes the inbox; SMS goes to the cleaner's own number", async () => {
    await expect(sendJobOfficeMessage(actor(), "j1", input({ transports: [] }))).rejects.toThrow();
    await sendJobOfficeMessage(actor(), "j1", input({ transports: ["INBOX", "PUSH", "SMS"] }));
    expect(m.office.mock.calls[0][0].transports).toEqual(["PUSH"]);
    expect(m.sms).toHaveBeenCalledWith("+61400000001", "sNeek office (J-7 at Bondi Flat): Gate code changed, see notes.");
  });

  it("refuses a transport that cannot be used, with the reason", async () => {
    m.providers.mockResolvedValue({ EMAIL: { available: true, reason: null }, SMS: { available: false, reason: "SMS is switched off in the settings." } });
    await expect(sendJobOfficeMessage(actor(), "j1", input({ transports: ["SMS"] }))).rejects.toMatchObject({ status: 400, message: "SMS cannot be used: SMS is switched off in the settings." });
  });

  it("reports provider answers truthfully and never as delivered", async () => {
    m.sms.mockResolvedValue({ ok: false, status: "failed", provider: "twilio", error: "nope" });
    const result = await sendJobOfficeMessage(actor(), "j1", input({ recipientIds: ["c1"], transports: ["SMS"] }));
    expect(result.outcomes).toEqual([{ userId: "c1", name: "Mia", transport: "SMS", state: "failed", reason: "SMS provider answered: failed." }]);
    expect(JSON.stringify(result)).not.toMatch(/deliver/i);
    expect(outcomeState("queued")).toBe("accepted");
    expect(outcomeState("switched_off")).toBe("skipped");
    expect(outcomeState("uncertain")).toBe("failed");
  });
});

describe("one send per request key, limits, audit", () => {
  it("answers a repeated key with the recorded outcomes and sends nothing again", async () => {
    m.auditFind.mockResolvedValue({ after: { outcomes: [{ userId: "c1", name: "Mia", transport: "INBOX", state: "accepted", reason: null }], refused: [], transportsUsed: ["INBOX"] } });
    const result = await sendJobOfficeMessage(actor(), "j1", input());
    expect(result).toMatchObject({ replayed: true, transportsUsed: ["INBOX"] });
    expect(m.office).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("is limited per job per day and per sender per hour", async () => {
    m.auditCount.mockResolvedValueOnce(12).mockResolvedValueOnce(0);
    await expect(sendJobOfficeMessage(actor(), "j1", input())).rejects.toMatchObject({ status: 429 });
    m.auditCount.mockResolvedValueOnce(0).mockResolvedValueOnce(30);
    await expect(sendJobOfficeMessage(actor(), "j1", input())).rejects.toMatchObject({ status: 429 });
    expect(m.office).not.toHaveBeenCalled();
  });

  it("audits on the job with the actor, role, text and outcomes, and remembers the choice only when asked", async () => {
    const who = { id: "ops-77", role: "OPS_MANAGER" as const };
    await sendJobOfficeMessage(who, "j1", input({ rememberTransports: true }));
    expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({
      userId: "ops-77", jobId: "j1", action: "JOB_OFFICE_MESSAGE_SENT", entity: "Job", entityId: "j1",
      after: { actorRole: "OPS_MANAGER", body: "Gate code changed, see notes.", recipientIds: ["c1", "c2"], transportsUsed: ["INBOX"], deliveryConfirmed: false },
    });
    expect(m.savePref).toHaveBeenCalledWith("ops-77", "job_office_message", ["INBOX"]);
  });
});

describe("preview, wording and catalog", () => {
  it("lists the assigned cleaners with what each transport can do", async () => {
    const preview = await previewJobOfficeMessage("j1", { id: "admin-1", impersonating: false });
    expect(preview.recipients).toEqual([{ id: "c1", name: "Mia", hasPhone: true }, { id: "c2", name: "Ben", hasPhone: false }]);
    expect(preview.transports.SMS).toEqual({ available: true, reason: null });
    expect(preview.title).toBe("Message from the office: J-7 at Bondi Flat");
  });

  it("disables each transport with its reason", () => {
    const team = [{ id: "c2", name: "Ben", hasPhone: false }];
    expect(jobMessageTransportOptions({ recipients: [], switchedOff: [], sms: { available: true, reason: null } }).INBOX.reason).toMatch(/Nobody is assigned/);
    expect(jobMessageTransportOptions({ recipients: team, switchedOff: [], sms: { available: true, reason: null } }).SMS.reason).toBe("No assigned cleaner has a phone number recorded.");
    expect(jobMessageTransportOptions({ recipients: team, switchedOff: ["INBOX"], sms: { available: false, reason: "SMS is not configured." } })).toMatchObject({ INBOX: { available: false }, PUSH: { available: false }, SMS: { reason: "SMS is not configured." } });
    expect(normalizeJobTransports(["SMS", "INBOX", "PUSH"])).toEqual(["PUSH", "SMS"]);
  });

  it("has a catalog entry and an editable wording definition whose default is the office's text", () => {
    const entry = NOTIFICATION_CATALOG.find((item) => item.key === "job.office_message");
    expect(entry).toMatchObject({ audienceKeys: ["CLEANER"], defaultTransports: ["INBOX"], producers: ["lib/notifications/job-office-message.ts"] });
    expect(wordingDefinition("job.office_message")?.status).toBe("EDITABLE");
    const wording = defaultNotificationWording("job.office_message");
    expect(wording.render("cleaner", "INBOX", { jobLabel: "J-1", propertyName: "P", messageText: "Hello" })).toMatchObject({ title: "Message from the office: J-1", body: "Hello" });
  });
});
