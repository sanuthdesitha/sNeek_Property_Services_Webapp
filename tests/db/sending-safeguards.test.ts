// @vitest-environment node
/**
 * Sending safeguards on a real, disposable PostgreSQL (127.0.0.1:55439):
 * caps under real concurrency, duplicate suppression, the circuit breaker
 * (one incident, ONE admin alert email, inbox kept), pause and resume, the
 * emergency stop (security mail still goes), quiet-hours hold and release
 * once, and "suppressed is never delivered". The email provider is a spy.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("resend", () => ({ Resend: class { emails = { send: m.send }; } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { guardOutbound } from "@/lib/notifications/safeguards/gate";
import { DEFAULT_SAFEGUARD_LIMITS, type SafeguardLimits } from "@/lib/notifications/safeguards/config";
import { SAFEGUARD_SETTINGS_KEY, pauseNotificationType, resumeIncident, setEmergencyStop } from "@/lib/notifications/safeguards/store";
import { releaseHeldMessages } from "@/lib/notifications/safeguards/held";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const run = randomUUID().slice(0, 8);
const startedAt = new Date();
const admin = { id: `sg-admin-${run}`, email: `sg-admin-${run}@example.invalid` };
const cleaners = Array.from({ length: 6 }, (_, index) => ({ id: `sg-cleaner-${run}-${index}`, email: `sg-cleaner-${run}-${index}@example.invalid` }));
let savedSettings: unknown = undefined;

async function writeLimits(patch: Partial<SafeguardLimits>) {
  const limits = { ...DEFAULT_SAFEGUARD_LIMITS, quietHours: { ...DEFAULT_SAFEGUARD_LIMITS.quietHours, enabled: false }, ...patch };
  const value = { limits, emergencyStop: { on: false, changedAt: null, changedById: null, reason: null }, updatedAt: null };
  await m.client.appSetting.upsert({ where: { key: SAFEGUARD_SETTINGS_KEY }, create: { key: SAFEGUARD_SETTINGS_KEY, value }, update: { value } });
}

function sentSubjects(): string[] {
  return m.send.mock.calls.map((call) => String((call[0] as { subject: string }).subject));
}

describe.skipIf(!url)("sending safeguards (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    savedSettings = (await m.client.appSetting.findUnique({ where: { key: SAFEGUARD_SETTINGS_KEY } }))?.value;
    await m.client.user.create({ data: { id: admin.id, name: "Fixture Admin", email: admin.email, role: "ADMIN", passwordHash: "fixture-only" } });
    for (const [index, cleaner] of cleaners.entries()) {
      await m.client.user.create({ data: { id: cleaner.id, name: `Fixture Cleaner ${index}`, email: cleaner.email, role: "CLEANER", passwordHash: "fixture-only" } });
    }
  });

  beforeEach(async () => {
    vi.stubEnv("RESEND_API_KEY", "fixture-key");
    m.send.mockReset().mockImplementation(async () => ({ data: { id: `provider-${randomUUID()}` }, error: null }));
    await writeLimits({});
  });

  afterAll(async () => {
    if (!m.client) return;
    const ids = [admin.id, ...cleaners.map((cleaner) => cleaner.id)];
    const keys = [admin.email, ...cleaners.map((cleaner) => cleaner.email)];
    await m.client.outboundMessageEvent.deleteMany({ where: { OR: [{ recipientKey: { in: [...keys, ...ids] } }, { createdAt: { gte: startedAt } }] } });
    await m.client.outboundSafeguardIncident.deleteMany({ where: { createdAt: { gte: startedAt } } });
    const intents = await m.client.notificationIntent.findMany({ where: { recipientId: { in: ids } }, select: { id: true } });
    await m.client.notificationAttempt.deleteMany({ where: { intentId: { in: intents.map((intent) => intent.id) } } });
    await m.client.notification.deleteMany({ where: { userId: { in: ids } } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: { in: ids } } });
    await m.client.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await m.client.appSetting.deleteMany({ where: { key: { startsWith: "notificationDispatch:" }, createdAt: { gte: startedAt } } });
    await m.client.user.deleteMany({ where: { id: { in: ids } } });
    await m.client.appSetting.deleteMany({ where: { key: SAFEGUARD_SETTINGS_KEY } });
    if (savedSettings !== undefined) await m.client.appSetting.create({ data: { key: SAFEGUARD_SETTINGS_KEY, value: savedSettings as never } });
    vi.unstubAllEnvs();
    await m.client.$disconnect();
  });

  it("caps one person per hour exactly, across concurrent senders", async () => {
    await writeLimits({ EMAIL: { perHour: 5, perDay: 20, sameSubjectMinutes: 30, breakerPerRecipient: 100 } });
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => guardOutbound({
      transport: "EMAIL", recipient: cleaners[0].email.toUpperCase(), subject: `Concurrent ${index}`, content: `<p>${index}</p>`,
      meta: { typeKey: "job.qa_and_accountability", entityKey: `Job:concurrent-${index}` },
    })));
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed && result.reason === "CAPPED_HOURLY")).toHaveLength(7);
    // The address is one person whatever its letter case.
    expect(await m.client.outboundMessageEvent.count({ where: { recipientKey: cleaners[0].email, decision: "ALLOWED" } })).toBe(5);
  });

  it("drops an identical message and counts it, but sends different content", async () => {
    const payload = { to: cleaners[1].email, subject: "Your QA result", html: "<p>Same words</p>", safeguard: { typeKey: "job.cleaner_requests_decided" } };
    expect(await sendEmailDetailed(payload)).toMatchObject({ ok: true });
    expect(await sendEmailDetailed(payload)).toMatchObject({ ok: false, skipped: true, suppressed: { reason: "DUPLICATE", held: false }, error: expect.stringMatching(/^Not sent \(sending safeguard\)/) });
    expect(await sendEmailDetailed({ ...payload, subject: "Another notice", html: "<p>Different</p>" })).toMatchObject({ ok: true });
    expect(m.send).toHaveBeenCalledTimes(2);
    expect(await m.client.outboundMessageEvent.count({ where: { recipientKey: cleaners[1].email, reason: "DUPLICATE" } })).toBe(1);
  });

  it("trips the breaker once: pauses the person, keeps the inbox, alerts administrators with ONE email", async () => {
    await writeLimits({ EMAIL: { perHour: 15, perDay: 50, sameSubjectMinutes: 30, breakerPerRecipient: 6 } });
    const cleaner = cleaners[2];
    for (let index = 0; index < 10; index += 1) {
      await sendEmailDetailed({ to: cleaner.email, subject: `Loop ${index}`, html: `<p>Loop ${index}</p>`, safeguard: { typeKey: "job.qa_and_accountability", entityKey: `Job:loop-${index}` } });
    }
    const incidents = await m.client.outboundSafeguardIncident.findMany({ where: { scopeKind: "RECIPIENT", scopeKey: cleaner.email } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ status: "ACTIVE", pausesSending: true, kind: "BREAKER" });
    expect(incidents[0].attemptCount).toBeGreaterThanOrEqual(10);
    expect(incidents[0].alertedAt).not.toBeNull();
    // Five went out before the trip (the sixth attempt trips it after being sent), the rest were paused.
    const toCleaner = sentSubjects().filter((subject) => subject.startsWith("Loop"));
    expect(toCleaner).toHaveLength(6);
    expect(await m.client.outboundMessageEvent.count({ where: { recipientKey: cleaner.email, reason: "PAUSED_RECIPIENT" } })).toBe(4);
    // Exactly one alert email to the administrator, and one inbox notice.
    expect(sentSubjects().filter((subject) => subject.startsWith("Sending paused"))).toHaveLength(1);
    expect(await m.client.notification.count({ where: { userId: admin.id, channel: "PUSH", subject: { startsWith: "Sending paused" } } })).toBe(1);
    // More attempts raise the count but never a second alert.
    await sendEmailDetailed({ to: cleaner.email, subject: "Loop again", html: "<p>again</p>" });
    expect(sentSubjects().filter((subject) => subject.startsWith("Sending paused"))).toHaveLength(1);
    expect(await m.client.outboundSafeguardIncident.count({ where: { scopeKind: "RECIPIENT", scopeKey: cleaner.email } })).toBe(1);
    // It stays paused until an administrator resumes it.
    await resumeIncident(admin.id, incidents[0].id, "Checked the QA sweep");
    expect(await m.client.auditLog.count({ where: { userId: admin.id, action: "NOTIFICATION_SAFEGUARD_RESUMED", entityId: incidents[0].id } })).toBe(1);
  });

  it("pauses and resumes a notification type, audited", async () => {
    const { incident } = await pauseNotificationType(admin.id, "job.cleaner_invoice", "Checking a loop");
    const payload = { to: cleaners[3].email, subject: "Invoice notice", html: "<p>Invoice</p>", safeguard: { typeKey: "job.cleaner_invoice" } };
    expect(await sendEmailDetailed(payload)).toMatchObject({ ok: false, suppressed: { reason: "PAUSED_TYPE" } });
    expect(m.send).not.toHaveBeenCalled();
    await resumeIncident(admin.id, incident.id, null);
    expect(await sendEmailDetailed({ ...payload, html: "<p>Invoice again</p>" })).toMatchObject({ ok: true });
    const actions = (await m.client.auditLog.findMany({ where: { userId: admin.id, entityId: incident.id }, orderBy: { createdAt: "asc" } })).map((row) => row.action);
    expect(actions).toEqual(["NOTIFICATION_TYPE_PAUSED", "NOTIFICATION_SAFEGUARD_RESUMED"]);
  });

  it("emergency stop stops ordinary email while a sign-in code still goes; audited both ways", async () => {
    await setEmergencyStop(admin.id, true, "Spam reported");
    expect(await sendEmailDetailed({ to: cleaners[4].email, subject: "Ordinary", html: "<p>ordinary</p>" })).toMatchObject({ ok: false, suppressed: { reason: "EMERGENCY_STOP" } });
    expect(await sendEmailDetailed({ to: cleaners[4].email, subject: "Your sign-in code", html: "<p>123456</p>", critical: true, transactional: true })).toMatchObject({ ok: true });
    expect(sentSubjects()).toEqual(["Your sign-in code"]);
    await setEmergencyStop(admin.id, false, null);
    expect(await sendEmailDetailed({ to: cleaners[4].email, subject: "Ordinary", html: "<p>after</p>" })).toMatchObject({ ok: true });
    const actions = (await m.client.auditLog.findMany({ where: { userId: admin.id, action: { startsWith: "NOTIFICATION_EMERGENCY_STOP" } }, orderBy: { createdAt: "asc" } })).map((row) => row.action);
    expect(actions).toEqual(["NOTIFICATION_EMERGENCY_STOP_ON", "NOTIFICATION_EMERGENCY_STOP_OFF"]);
  });

  it("holds a non-urgent staff email over quiet hours and sends it once after", async () => {
    await writeLimits({ quietHours: { enabled: true, start: "21:00", end: "07:00" } });
    const night = new Date("2026-11-15T12:30:00Z"); // 23:30 Sydney (daylight time)
    const held = await guardOutbound({
      transport: "EMAIL", recipient: cleaners[5].email, subject: "Your QA result", content: "<p>QA held</p>",
      meta: { typeKey: "job.qa_and_accountability", entityKey: "Job:held" },
      holdPayload: { transport: "EMAIL", to: cleaners[5].email, subject: "Your QA result", html: "<p>QA held</p>" },
    }, night);
    expect(held).toMatchObject({ allowed: false, held: true, reason: "QUIET_HOURS_HELD" });
    const urgent = await guardOutbound({ transport: "EMAIL", recipient: cleaners[5].email, subject: "Shift cancelled", content: "<p>cancelled</p>", meta: { typeKey: "job.skipped_or_cancelled" } }, night);
    expect(urgent.allowed).toBe(true);
    await writeLimits({});
    expect(await releaseHeldMessages(false)).toMatchObject({ released: 1 });
    expect(await releaseHeldMessages(false)).toMatchObject({ released: 0 });
    expect(sentSubjects()).toEqual(["Your QA result"]);
    expect(await m.client.outboundMessageEvent.findUnique({ where: { id: held.eventId! } })).toMatchObject({ decision: "RELEASED", heldPayload: null });
  });

  it("never reports a suppressed email as delivered: the inbox stays, the email row says not sent", async () => {
    await writeLimits({ EMAIL: { perHour: 5, perDay: 20, sameSubjectMinutes: 30, breakerPerRecipient: 100 } });
    const cleaner = cleaners[0]; // already at its hourly limit from the first test
    await deliverNotificationToRecipients({
      recipients: [{ id: cleaner.id, role: "CLEANER", email: cleaner.email, name: "Fixture Cleaner 0" }],
      category: "jobs", typeKey: "job.qa_and_accountability", jobId: null,
      web: { subject: "QA needs attention", body: "See the app." },
      email: { subject: "QA needs attention", html: "<p>See the app.</p>" },
    });
    const rows = await m.client.notification.findMany({ where: { userId: cleaner.id }, orderBy: { createdAt: "asc" } });
    expect(rows.find((row) => row.channel === "PUSH")).toMatchObject({ status: "SENT", subject: "QA needs attention" });
    expect(rows.find((row) => row.channel === "EMAIL")).toMatchObject({ status: "FAILED", sentAt: null, deliveryStatus: "SUPPRESSED", errorMsg: expect.stringMatching(/^Not sent \(sending safeguard\): hourly limit/) });
    expect(m.send).not.toHaveBeenCalled();
    const event = await m.client.outboundMessageEvent.findFirst({ where: { recipientKey: cleaner.email, subject: "QA needs attention" } });
    expect(event).toMatchObject({ decision: "SUPPRESSED", reason: "CAPPED_HOURLY", outcome: null });
  });

  it("refuses a send to too many recipients whole, and a disabled account", async () => {
    await writeLimits({ maxRecipientsPerSend: 5 });
    const many = Array.from({ length: 6 }, (_, index) => `bulk-${run}-${index}@example.invalid`);
    expect(await sendEmailDetailed({ to: many, subject: "Everyone", html: "<p>hi</p>" })).toMatchObject({ ok: false, suppressed: { reason: "TOO_MANY_RECIPIENTS" } });
    await m.client.user.update({ where: { id: cleaners[3].id }, data: { isActive: false } });
    expect(await sendEmailDetailed({ to: cleaners[3].email, subject: "Hello", html: "<p>hello disabled</p>" })).toMatchObject({ ok: false, suppressed: { reason: "INACTIVE_ACCOUNT" } });
    await m.client.user.update({ where: { id: cleaners[3].id }, data: { isActive: true } });
    expect(m.send).not.toHaveBeenCalled();
  });
});
