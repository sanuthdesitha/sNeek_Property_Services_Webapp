// @vitest-environment node
/**
 * The combined reminder email is delivered with `channels: { email: true }`:
 * no inbox row, device push or SMS comes with it, and the cleaner's email
 * preference and the audience controls still decide whether it goes. The
 * per-job push and SMS of a combined day-of run use `{ web, sms }` only.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS } from "@/lib/notifications/audience-controls";

const m = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn(), prefs: vi.fn(), email: vi.fn(), sms: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { notification: { create: m.create } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ notificationAudienceControls: DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS }) }));
vi.mock("@/lib/notifications/preferences", () => ({ canDeliverNotification: m.prefs }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPushToUser: m.push }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));

import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";

const cleaner = { id: "jane", role: "CLEANER" as const, email: "jane@example.invalid", phone: "0400000001", name: "Jane" };
const combined = {
  recipients: [cleaner],
  category: "jobs" as const,
  typeKey: "job.cleaner_day_reminder",
  jobId: null,
  web: { subject: "Your 3 jobs today", body: "Your 3 jobs today" },
  email: { subject: "Your 3 jobs today", html: "<p>list</p>", logBody: "Combined day reminder (3 jobs)" },
  sms: "should never be sent",
  channels: { email: true },
  safeguardSubject: { entityKey: "JobReminderBatch:abc", relatedEntityKeys: ["Job:a", "Job:b", "Job:c"] },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.prefs.mockResolvedValue(true);
  m.email.mockResolvedValue({ ok: true, externalId: "provider-1" });
  m.sms.mockResolvedValue({ ok: true, status: "sent" });
});

it("sends only the email, as one message with the batch subject and every job", async () => {
  await deliverNotificationToRecipients(combined);
  expect(m.push).not.toHaveBeenCalled();
  expect(m.sms).not.toHaveBeenCalled();
  expect(m.email).toHaveBeenCalledTimes(1);
  expect(m.email.mock.calls[0][0]).toMatchObject({
    kind: "job_reminder",
    to: "jane@example.invalid",
    safeguard: { typeKey: "job.cleaner_day_reminder", entityKey: "JobReminderBatch:abc", relatedEntityKeys: ["Job:a", "Job:b", "Job:c"], recipientUserId: "jane" },
  });
  // The delivery log records the one email (not an inbox row).
  expect(m.create).toHaveBeenCalledTimes(1);
  expect(m.create.mock.calls[0][0].data).toMatchObject({ channel: "EMAIL", jobId: null, body: "Combined day reminder (3 jobs)" });
});

it("sends nothing when the cleaner switched job email off", async () => {
  m.prefs.mockImplementation(async ({ channel }: { channel: string }) => channel !== "EMAIL");
  await deliverNotificationToRecipients(combined);
  expect(m.email).not.toHaveBeenCalled();
  expect(m.push).not.toHaveBeenCalled();
  expect(m.sms).not.toHaveBeenCalled();
});

it("per-job push and SMS of a combined run leave the email out, with preferences unchanged", async () => {
  m.prefs.mockImplementation(async ({ channel }: { channel: string }) => channel !== "EMAIL");
  await deliverNotificationToRecipients({ ...combined, jobId: "a", email: null, sms: "Today at 08:00", channels: { web: true, sms: true }, safeguardSubject: undefined });
  expect(m.email).not.toHaveBeenCalled();
  expect(m.push).toHaveBeenCalledTimes(1);
  expect(m.sms).toHaveBeenCalledTimes(1);
  expect(m.sms.mock.calls[0][3]).toMatchObject({ entityKey: "Job:a" });
});

it("still uses every transport when no channels are named (all existing callers)", async () => {
  await deliverNotificationToRecipients({ ...combined, jobId: "a", channels: undefined, safeguardSubject: undefined });
  expect(m.push).toHaveBeenCalledTimes(1);
  expect(m.email).toHaveBeenCalledTimes(1);
  expect(m.sms).toHaveBeenCalledTimes(1);
});
