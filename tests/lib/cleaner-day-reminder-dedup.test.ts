// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { dispatchNotificationOnce } from "@/lib/notifications/dispatch-once";
import { dispatchCleanerDayReminders } from "@/lib/ops/cleaner-day-reminders";
const m = vi.hoisted(() => ({ rows: new Map<string, any>(), send: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: m.send }));
vi.mock("@/lib/db", () => ({ db: {
  job: { findMany: async () => [{ id: "job", jobNumber: "J1", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-10-03T00:00:00Z"), startTime: "10:00", property: { name: "Property", address: "Address" }, assignments: [{ user: { id: "cleaner", role: "CLEANER", name: "Cleaner" } }] }] },
  notification: { findFirst: async () => null },
  appSetting: { create: m.create, update: m.update },
} }));
const NOW = new Date("2026-10-03T00:00:00Z");
beforeEach(() => {
  vi.clearAllMocks(); m.rows.clear(); m.send.mockResolvedValue(undefined);
  m.create.mockImplementation(async ({ data }) => {
    if (m.rows.has(data.key)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
    m.rows.set(data.key, data.value); return data;
  });
  m.update.mockImplementation(async ({ where, data }) => { m.rows.set(where.key, data.value); return data; });
});
it("claims one multi-channel attempt across concurrent scheduler ticks", async () => {
  await Promise.all([dispatchCleanerDayReminders(NOW), dispatchCleanerDayReminders(NOW)]);
  await dispatchCleanerDayReminders(NOW);
  expect(m.send).toHaveBeenCalledTimes(1); expect(m.rows.size).toBe(1);
  expect([...m.rows.values()][0].status).toBe("ATTEMPTED");
});
it("retains uncertain partial delivery rather than sending all channels again", async () => {
  m.send.mockRejectedValueOnce(new Error("provider outcome unknown"));
  await expect(dispatchCleanerDayReminders(NOW)).rejects.toThrow("provider outcome unknown");
  await dispatchCleanerDayReminders(NOW);
  expect(m.send).toHaveBeenCalledTimes(1);
  expect([...m.rows.values()][0].status).toBe("UNCERTAIN");
});
it("does not send if the durable claim cannot be committed", async () => {
  m.create.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(dispatchCleanerDayReminders(NOW)).rejects.toThrow("database unavailable");
  expect(m.send).not.toHaveBeenCalled();
});

it("deduplicates recipient-only events using the default timestamp", async () => {
  const identity = { event: "daily.summary", day: "2026-10-03", recipientId: "cleaner" };
  expect(await dispatchNotificationOnce(identity, m.send)).toBe(true);
  expect(await dispatchNotificationOnce(identity, m.send)).toBe(false);
  expect(m.send).toHaveBeenCalledTimes(1);
  expect([...m.rows.values()][0]).toMatchObject({ status: "ATTEMPTED", startedAt: expect.any(String) });
});
it("retains its original claim when both delivery and uncertainty recording fail", async () => {
  m.send.mockRejectedValueOnce(new Error("partial delivery"));
  m.update.mockRejectedValueOnce(new Error("ledger unavailable"));
  await expect(dispatchCleanerDayReminders(NOW)).rejects.toThrow("partial delivery");
  expect([...m.rows.values()][0].status).toBe("PROCESSING");
  await dispatchCleanerDayReminders(NOW);
  expect(m.send).toHaveBeenCalledTimes(1);
});
it("propagates even an empty claim error without dispatching", async () => {
  m.create.mockRejectedValueOnce(null);
  await expect(dispatchCleanerDayReminders(NOW)).rejects.toBeNull();
  expect(m.send).not.toHaveBeenCalled();
});
