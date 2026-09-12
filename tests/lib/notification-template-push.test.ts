import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationChannel } from "@prisma/client";
import { sendNotification } from "@/lib/notifications/engine";

const mocks = vi.hoisted(() => ({ preference: vi.fn(), template: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  notificationPreference: { findUnique: mocks.preference },
  notificationTemplate: { findUnique: mocks.template },
  notificationLog: { create: mocks.log },
} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preference.mockResolvedValue(null);
  mocks.template.mockResolvedValue({ pushTitle: "Invoice ready", pushBody: "Ready" });
  mocks.log.mockResolvedValue({});
});
describe("template push delivery", () => {
  it("cannot record a successful delivery without a transport", async () => {
    await sendNotification("invoice_approved", {}, { channels: [NotificationChannel.PUSH] });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", error: expect.stringContaining("not configured") }) }));
  });
});
