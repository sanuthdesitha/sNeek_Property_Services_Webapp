// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS } from "@/lib/notifications/audience-controls";
const m = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn(), prefs: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { notification: { create: m.create } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ notificationAudienceControls: DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS }) }));
vi.mock("@/lib/notifications/preferences", () => ({ canDeliverNotification: m.prefs }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPushToUser: m.push }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn(() => { throw new Error("Unexpected email"); }) }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: vi.fn(() => { throw new Error("Unexpected SMS"); }) }));
beforeEach(() => { vi.clearAllMocks(); m.prefs.mockResolvedValue(true); m.push.mockResolvedValue(undefined); });
it.each(["laundry", "billing", "approvals", "jobs"] as const)("preserves %s category and deduplicates the recipient before queuing mobile delivery", async category => {
  const recipient = { id: "admin", role: "ADMIN" as const };
  await deliverNotificationToRecipients({ recipients: [recipient, recipient], category, jobId: "job", web: { subject: "Update", body: "Review it" }, url: "/admin" });
  expect(m.create).toHaveBeenCalledOnce();
  expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "admin", jobId: "job", externalId: `mobile-outbox:pending:${category}`, status: "SENT" }) });
  expect(m.prefs).toHaveBeenCalledWith(expect.objectContaining({ category, channel: "WEB" }));
});
it("does not create a mobile queue entry when web consent is off", async () => {
  m.prefs.mockResolvedValue(false);
  await deliverNotificationToRecipients({ recipients: [{ id: "admin", role: "ADMIN" }], category: "laundry", web: { subject: "Update", body: "Review" } });
  expect(m.create).not.toHaveBeenCalled(); expect(m.push).not.toHaveBeenCalled();
});
