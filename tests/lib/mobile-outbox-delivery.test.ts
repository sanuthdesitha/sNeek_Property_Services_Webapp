// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { deliverMobilePushNotification } from "@/lib/notifications/mobile-push";
import { DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS } from "@/lib/notifications/audience-controls";
const m = vi.hoisted(() => ({ settings: vi.fn(), prefs: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/preferences", () => ({ getUserNotificationPreferences: m.prefs }));
const user = vi.fn(); const devices = vi.fn();
const prisma = { user: { findUnique: user }, userPushDevice: { findMany: devices, updateMany: vi.fn() } } as any;
const notification = { id: "n1", userId: "u1", subject: "Laundry", body: "Pickup needed", jobId: null };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", m.fetch);
  user.mockResolvedValue({ id: "u1", role: "LAUNDRY", isActive: true });
  devices.mockResolvedValue([{ token: "ExpoPushToken[device1]" }]);
  m.prefs.mockResolvedValue({ laundry: { web: true }, jobs: { web: true } });
  m.settings.mockResolvedValue({ notificationAudienceControls: DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS });
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: "ok", id: "ticket1" }] }) });
});
it("checks current active user and category preference before contacting provider", async () => {
  user.mockResolvedValueOnce({ id: "u1", role: "LAUNDRY", isActive: false });
  expect(await deliverMobilePushNotification(prisma, notification, "laundry")).toBe("SKIPPED");
  m.prefs.mockResolvedValue({ laundry: { web: false }, jobs: { web: true } });
  expect(await deliverMobilePushNotification(prisma, notification, "laundry")).toBe("SKIPPED");
  expect(m.fetch).not.toHaveBeenCalled();
});
it("does not contact provider when the global audience switch is off", async () => {
  m.settings.mockResolvedValue({ notificationAudienceControls: { ...DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS, channels: { email: true, sms: true, push: false } } });
  expect(await deliverMobilePushNotification(prisma, notification, "laundry")).toBe("SKIPPED"); expect(m.fetch).not.toHaveBeenCalled();
});
it("records provider acceptance separately from delivery", async () => {
  expect(await deliverMobilePushNotification(prisma, notification, "laundry")).toBe("ACCEPTED");
});
it("does not classify a timeout or partial provider result as safe to retry", async () => {
  m.fetch.mockRejectedValueOnce(new Error("timeout"));
  expect(await deliverMobilePushNotification(prisma, notification, "laundry")).toBe("UNCERTAIN");
  devices.mockResolvedValue([{ token: "ExpoPushToken[device1]" }, { token: "ExpoPushToken[device2]" }]);
  expect(await deliverMobilePushNotification(prisma, notification, "laundry")).toBe("UNCERTAIN");
});
it("retires rejected Expo tokens and reports a definite rejection as failed", async () => {
  m.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }) });
  expect(await deliverMobilePushNotification(prisma, notification, "laundry")).toBe("FAILED");
  expect(prisma.userPushDevice.updateMany).toHaveBeenCalledWith({ where: { token: { in: ["ExpoPushToken[device1]"] } }, data: { isActive: false, lastSeenAt: expect.any(Date) } });
});
it("holds partial acceptance rather than resending to the accepted device", async () => {
  devices.mockResolvedValue([{ token: "ExpoPushToken[device1]" }, { token: "ExpoPushToken[device2]" }]);
  m.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ status: "ok", id: "accepted" }, { status: "error", details: { error: "DeviceNotRegistered" } }] }) });
  expect(await deliverMobilePushNotification(prisma, notification, "laundry")).toBe("UNCERTAIN");
  expect(m.fetch).toHaveBeenCalledOnce();
});
