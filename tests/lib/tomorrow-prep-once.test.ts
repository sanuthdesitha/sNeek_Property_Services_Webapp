// @vitest-environment node
/**
 * Cause #2 (2026-11-15): the evening "tomorrow's jobs" summary emailed and
 * texted EVERY active cleaner and recorded the day as done only after the
 * last recipient. A run that failed part-way (or was cut off) left the day
 * unrecorded, so the next two-hourly tick emailed and texted everyone again.
 * Each person is now claimed once per part and day before sending, and a
 * cleaner with nothing tomorrow gets the inbox notice only.
 */
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  receipts: new Set<string>(),
  email: vi.fn(async () => ({ ok: true, acceptance: "ACCEPTED", externalId: "provider-1" })),
  sms: vi.fn(async () => ({ ok: true, status: "sent", provider: "twilio" })),
  inbox: vi.fn(async () => ({})),
  saveState: vi.fn(async () => { throw new Error("worker stopped before recording the day"); }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    appSetting: {
      findUnique: vi.fn(async () => null),
      upsert: m.saveState,
      create: vi.fn(async ({ data }: { data: { key: string } }) => {
        if (m.receipts.has(data.key)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        m.receipts.add(data.key);
        return data;
      }),
      update: vi.fn(async () => ({})),
    },
    job: { findMany: vi.fn(async () => [{
      id: "job-1", jobNumber: "J-1", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-16T00:00:00Z"), startTime: "10:00", dueTime: null,
      priorityBucket: 3, priorityReason: null, notes: null, internalNotes: null,
      property: { id: "p1", name: "House", suburb: "Bondi", accessInfo: null },
      assignments: [{ user: { id: "busy", name: "Busy Cleaner", email: "busy@example.invalid", phone: "0400000001", role: "CLEANER" } }],
    }]) },
    laundryTask: { findMany: vi.fn(async () => []) },
    propertyStock: { findMany: vi.fn(async () => []), fields: { reorderThreshold: "reorderThreshold" } },
    user: { findMany: vi.fn(async ({ where }: { where: { role?: string } }) => (where.role === "LAUNDRY" ? [] : [
      { id: "busy", name: "Busy Cleaner", email: "busy@example.invalid", phone: "0400000001", role: "CLEANER" },
      { id: "idle", name: "Idle Cleaner", email: "idle@example.invalid", phone: "0400000002", role: "CLEANER" },
    ])) },
    notification: { create: m.inbox },
  },
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({
  timezone: "Australia/Sydney", companyName: "Company", logoUrl: null, emailTemplates: {},
  scheduledNotifications: { tomorrowPrepEnabled: true, tomorrowPrepTime: "17:00" },
}) }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: () => ({ subject: "Tomorrow", html: "<p>Tomorrow</p>" }) }));
vi.mock("@/lib/notification-templates", () => ({ renderNotificationTemplate: () => ({ webSubject: "Tomorrow", webBody: "Your day", smsBody: "Tomorrow" }) }));
vi.mock("@/lib/notifications/wording/render", () => ({ loadNotificationWording: async () => ({ render: () => ({ title: "", body: "", subject: "", html: "" }), line: () => "" }) }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => path }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { dispatchTomorrowPrepSummaries } from "@/lib/ops/tomorrow-prep";

const evening = new Date("2026-11-15T07:00:00Z"); // 18:00 Sydney

beforeEach(() => {
  m.receipts.clear();
  m.email.mockClear();
  m.sms.mockClear();
  m.inbox.mockClear();
});

it("a scheduled run that keeps failing before it records the day emails and texts each person once", async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(dispatchTomorrowPrepSummaries(new Date(evening.getTime() + attempt * 2 * 3_600_000))).rejects.toThrow("worker stopped");
  }
  expect(m.email).toHaveBeenCalledTimes(1);
  expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: "busy@example.invalid", safeguard: expect.objectContaining({ typeKey: "office.sla_and_summaries" }) }));
  expect(m.sms).toHaveBeenCalledTimes(1);
});

it("a cleaner with nothing tomorrow gets the inbox notice only, never an email or SMS", async () => {
  await dispatchTomorrowPrepSummaries(evening).catch(() => undefined);
  const inboxFor = m.inbox.mock.calls.map((call) => (call[0] as { data: { userId: string } }).data.userId);
  expect(inboxFor).toEqual(expect.arrayContaining(["busy", "idle"]));
  expect(m.email.mock.calls.map((call) => (call[0] as { to: string }).to)).toEqual(["busy@example.invalid"]);
});

it("an administrator's manual send now still sends (no receipt)", async () => {
  await dispatchTomorrowPrepSummaries(evening, { ignoreWindow: true });
  await dispatchTomorrowPrepSummaries(evening, { ignoreWindow: true });
  expect(m.email).toHaveBeenCalledTimes(2);
});
