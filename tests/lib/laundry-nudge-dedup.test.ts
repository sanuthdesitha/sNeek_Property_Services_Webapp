// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { dispatchLaundryDriverNudges } from "@/lib/laundry/reminders";
import { DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS } from "@/lib/notifications/audience-controls";
const m = vi.hoisted(() => ({ ids: new Set<string>(), created: vi.fn(), push: vi.fn(), allowed: vi.fn(), tasks: vi.fn(), audience: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: m.error } }));
vi.mock("@/lib/notifications/audience-controls", async importOriginal => ({ ...await importOriginal<object>(), isChannelAllowed: m.audience }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPushToUser: m.push }));
vi.mock("@/lib/notifications/preferences", () => ({ canDeliverNotification: m.allowed }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ notificationAudienceControls: DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS }) }));
vi.mock("@/lib/db", () => ({ db: {
  laundryRoute: { updateMany: async () => ({ count: 0 }) },
  laundryTask: { findMany: m.tasks },
  user: { findMany: async () => [{ id: "driver" }] }, notification: { create: m.created },
} }));
beforeEach(() => {
  vi.clearAllMocks(); m.ids.clear(); m.allowed.mockResolvedValue(true); m.audience.mockReturnValue(true); m.push.mockResolvedValue(undefined);
  m.tasks.mockResolvedValue([{ id: "task", status: "PENDING", pickupDate: new Date("2026-10-03"), dropoffDate: new Date("2026-10-04"), updatedAt: new Date("2026-10-01"), property: { name: "Property", laundryEnabled: true } }]);
  m.created.mockImplementation(async ({ data }) => {
    if (m.ids.has(data.id)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
    m.ids.add(data.id); return data;
  });
});
it("creates one durable nudge and one web push per driver/day under concurrent repeats", async () => {
  const now = new Date("2026-10-03T05:00:00Z");
  await Promise.all([dispatchLaundryDriverNudges(now), dispatchLaundryDriverNudges(now)]);
  await dispatchLaundryDriverNudges(now);
  expect(m.ids.size).toBe(1); expect(m.push).toHaveBeenCalledTimes(1);
  expect(m.created.mock.calls[0][0].data.externalId).toBe("mobile-outbox:pending:laundry");
});
it("does not create a nudge when laundry notifications are disabled for the driver", async () => {
  m.allowed.mockResolvedValue(false); await dispatchLaundryDriverNudges(new Date("2026-10-03T05:00:00Z"));
  expect(m.created).not.toHaveBeenCalled(); expect(m.push).not.toHaveBeenCalled();
});

it("does not consult preferences or dispatch when the audience switch is disabled", async () => {
  m.audience.mockReturnValue(false);
  expect(await dispatchLaundryDriverNudges(new Date("2026-10-03T05:00:00Z"))).toMatchObject({ nudged: 0 });
  expect(m.allowed).not.toHaveBeenCalled(); expect(m.created).not.toHaveBeenCalled();
});
it("does not reserve a daily receipt when no visible stale tasks exist", async () => {
  m.tasks.mockResolvedValue([]);
  await dispatchLaundryDriverNudges(new Date("2026-10-03T05:00:00Z"));
  expect(m.created).not.toHaveBeenCalled(); expect(m.allowed).not.toHaveBeenCalled();
});
it("logs a failed insert without sending a push or counting delivery", async () => {
  m.created.mockRejectedValueOnce(new Error("database unavailable"));
  expect(await dispatchLaundryDriverNudges(new Date("2026-10-03T05:00:00Z"))).toMatchObject({ nudged: 0 });
  expect(m.error).toHaveBeenCalledOnce(); expect(m.push).not.toHaveBeenCalled();
});
it("retains a committed daily receipt after ambiguous web push failure", async () => {
  m.push.mockRejectedValueOnce(new Error("network timeout"));
  const now = new Date("2026-10-03T05:00:00Z");
  expect(await dispatchLaundryDriverNudges(now)).toMatchObject({ nudged: 0 });
  await dispatchLaundryDriverNudges(now);
  expect(m.push).toHaveBeenCalledOnce(); expect(m.error).toHaveBeenCalledOnce();
});
it("summarizes a long multi-task catch-up without exposing all properties", async () => {
  const task = (await m.tasks())[0];
  m.tasks.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ ...task, id: String(i), property: { laundryEnabled: true, name: i === 0 ? null : `Property ${i}` } })));
  await dispatchLaundryDriverNudges(new Date("2026-10-03T05:00:00Z"));
  expect(m.created.mock.calls[0][0].data.body).toContain("5 laundry tasks need action: a property, Property 1, Property 2, Property 3 +1 more");
});
