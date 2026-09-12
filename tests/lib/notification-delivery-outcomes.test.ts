// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationChannel } from "@prisma/client";
import { sendLifecycleEmail } from "@/lib/notifications/lifecycle";
import { canDeliverNotification } from "@/lib/notifications/preferences";
const mocks = vi.hoisted(() => ({ send: vi.fn(), log: vi.fn(), prefs: vi.fn() }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: mocks.send }));
vi.mock("@/lib/commercial/delivery-profiles", () => ({ resolveClientDeliveryRecipients: vi.fn() }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://example.test${path}` }));
vi.mock("@/lib/settings", () => ({
  NOTIFICATION_CATEGORIES: ["jobs"], DEFAULT_NOTIFICATION_PREFERENCES: { jobs: { web: true, email: true, sms: false } },
  getAppSettings: async () => ({ companyName: "Test", notificationDefaults: { categories: { jobs: { web: true, email: true, sms: false } } } }),
}));
vi.mock("@/lib/db", () => ({ db: {
  client: { findUnique: async () => ({ id: "client", name: "Client", notificationPref: { notificationsEnabled: true } }) },
  user: { findMany: async () => [{ id: "user", email: "user@example.test" }] },
  notification: { create: mocks.log },
  userNotificationPreference: { findUnique: mocks.prefs },
} }));
beforeEach(() => { vi.resetAllMocks(); mocks.log.mockResolvedValue({}); mocks.prefs.mockResolvedValue(null); });
describe("truthful notification delivery", () => {
  it.each([
    [{ ok: true, externalId: "provider-id" }, true, "accepted by provider for"],
    [{ ok: false, skipped: true, error: "suppressed" }, false, "skipped for"],
    [{ ok: false, error: "provider failed" }, false, "failed for"],
  ])("reports provider outcome %j", async (outcome, sent, wording) => {
    mocks.send.mockResolvedValue(outcome);
    const result = await sendLifecycleEmail({ clientId: "client", stage: "CUSTOM" });
    expect(result.sent).toBe(sent);
    expect(result.recipients).toEqual(sent ? ["user@example.test"] : []);
    expect(mocks.log.mock.calls[0][0].data.body).toContain(wording);
    expect(mocks.log.mock.calls[0][0].data.sentAt !== undefined).toBe(sent);
  });
  it("uses web consent for push, independently of SMS consent and phone", async () => {
    expect(await canDeliverNotification({ userId: "user", category: "jobs", channel: NotificationChannel.PUSH, hasPhone: false })).toBe(true);
    expect(await canDeliverNotification({ userId: "user", category: "jobs", channel: NotificationChannel.SMS, hasPhone: true })).toBe(false);
    mocks.prefs.mockResolvedValue({ categories: { jobs: { web: false, email: true, sms: true } } });
    expect(await canDeliverNotification({ userId: "user", category: "jobs", channel: NotificationChannel.PUSH })).toBe(false);
  });
});
