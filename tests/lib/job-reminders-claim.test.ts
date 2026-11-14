// @vitest-environment node
/**
 * Cause #3 (2026-11-15): the 24-hour job reminder recorded "sent" only AFTER
 * sending and only when the provider gave a clear yes. A provider answer that
 * was not a clear yes (timeout, 5xx after accepting) or a failed flag update
 * left the job unflagged, so every 30-minute tick emailed the cleaners again
 * for the whole reminder window. The job is now claimed before sending.
 */
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const job = {
    id: "job-1", jobNumber: "J-1", jobType: "AIRBNB_TURNOVER", startTime: "10:00", dueTime: null, endTime: null, internalNotes: null,
    scheduledDate: new Date("2026-11-16T00:00:00Z"), reminder24hSent: false, reminder2hSent: false,
    property: { name: "House", address: "1 Beach Rd" },
    assignments: [{ user: { name: "Cleaner", email: "cleaner@example.invalid", phone: "0400000000" } }],
  };
  return {
    job,
    email: vi.fn(),
    sms: vi.fn(),
    lifecycle: vi.fn(async () => undefined),
  };
});

type Flag = "reminder24hSent" | "reminder2hSent";

vi.mock("@/lib/db", () => ({
  db: {
    job: {
      findMany: vi.fn(async ({ where }: { where: Partial<Record<Flag, boolean>> }) => {
        const flags = Object.entries(where).filter(([key]) => key === "reminder24hSent" || key === "reminder2hSent") as Array<[Flag, boolean]>;
        return flags.every(([key, value]) => m.job[key] === value) ? [m.job] : [];
      }),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async ({ where, data }: { where: Partial<Record<Flag, boolean>>; data: Partial<Record<Flag, boolean>> }) => {
        const flags = Object.entries(where).filter(([key]) => key === "reminder24hSent" || key === "reminder2hSent") as Array<[Flag, boolean]>;
        if (!flags.every(([key, value]) => m.job[key] === value)) return { count: 0 };
        Object.assign(m.job, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Partial<Record<Flag, boolean>> }) => Object.assign(m.job, data)),
    },
  },
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({
  timezone: "Australia/Sydney", reminder24hHours: 24, reminder2hHours: 2,
  scheduledNotifications: { reminder24hEnabled: true, reminder2hEnabled: true },
}) }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: () => ({ subject: "Reminder: tomorrow", html: "<p>Tomorrow</p>" }) }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email, sendEmail: async (payload: unknown) => Boolean((await m.email(payload))?.ok) }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: m.lifecycle }));
vi.mock("@/lib/notifications/wording/render", () => ({ loadNotificationWording: async () => ({ render: () => ({ title: "", body: "SMS", subject: "", html: "" }), line: () => "" }) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { dispatchJobReminders } from "@/lib/ops/reminders";

const now = new Date("2026-11-15T00:00:00Z"); // 11:00 Sydney the day before a 10:00 job

beforeEach(() => {
  m.job.reminder24hSent = false;
  m.job.reminder2hSent = false;
  m.email.mockReset();
  m.sms.mockReset();
});

it("emails once when the provider's answer is uncertain, across repeated 30-minute ticks", async () => {
  m.email.mockResolvedValue({ ok: false, acceptance: "UNKNOWN", error: "timeout after sending" });
  for (let tick = 0; tick < 3; tick += 1) {
    await dispatchJobReminders({ now: new Date(now.getTime() + tick * 30 * 60_000), reminderType: "LONG" });
  }
  expect(m.email).toHaveBeenCalledTimes(1);
  expect(m.job.reminder24hSent).toBe(true);
});

it("does not resend after the safeguards held or dropped it", async () => {
  m.email.mockResolvedValue({ ok: false, skipped: true, acceptance: "NOT_ACCEPTED", suppressed: { reason: "QUIET_HOURS_HELD", held: true } });
  await dispatchJobReminders({ now, reminderType: "LONG" });
  await dispatchJobReminders({ now: new Date(now.getTime() + 30 * 60_000), reminderType: "LONG" });
  expect(m.email).toHaveBeenCalledTimes(1);
});

it("tries again later only when nothing reached a provider (switched off, no key)", async () => {
  m.email.mockResolvedValue({ ok: false, skipped: true, error: "auto-email-disabled" });
  await dispatchJobReminders({ now, reminderType: "LONG" });
  expect(m.job.reminder24hSent).toBe(false);
  m.email.mockResolvedValue({ ok: true, acceptance: "ACCEPTED", externalId: "provider-1" });
  await dispatchJobReminders({ now: new Date(now.getTime() + 30 * 60_000), reminderType: "LONG" });
  await dispatchJobReminders({ now: new Date(now.getTime() + 60 * 60_000), reminderType: "LONG" });
  expect(m.email).toHaveBeenCalledTimes(2);
  expect(m.lifecycle).toHaveBeenCalledTimes(1);
});

it("texts once for the 2-hour reminder when the SMS provider failed after the request", async () => {
  m.sms.mockResolvedValue({ ok: false, status: "failed", provider: "twilio", error: "socket hang up" });
  const close = new Date("2026-11-15T22:30:00Z"); // 09:30 Sydney, 30 minutes before the job
  await dispatchJobReminders({ now: close, reminderType: "SHORT" });
  await dispatchJobReminders({ now: new Date(close.getTime() + 10 * 60_000), reminderType: "SHORT" });
  expect(m.sms).toHaveBeenCalledTimes(1);
});
