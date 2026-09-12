// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/notifications/preferences/route";
import { POST as subscribe } from "@/app/api/push/subscribe/route";
import { POST as unsubscribe } from "@/app/api/push/unsubscribe/route";
const mocks = vi.hoisted(() => ({ session: vi.fn(), save: vi.fn(), upsert: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/notifications/preferences", () => ({ getUserNotificationPreferences: vi.fn(), saveUserNotificationPreferences: mocks.save }));
vi.mock("@/lib/db", () => ({ db: { pushSubscription: { upsert: mocks.upsert, deleteMany: mocks.remove } } }));
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: "user" } }); });
it("persists calendar feed preferences instead of silently dropping them", async () => {
  const body = { ical: { web: false, email: false, sms: false } };
  mocks.save.mockResolvedValue(body);
  const response = await PATCH(new NextRequest("http://localhost/api/notifications/preferences", { method: "PATCH", body: JSON.stringify(body) }));
  expect(response.status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith("user", body);
});
it.each([subscribe, unsubscribe])("rejects device mutations during impersonation", async handler => {
  mocks.session.mockResolvedValue({ user: { id: "user" }, impersonation: { actorId: "admin" } });
  expect((await handler(new NextRequest("http://localhost/api/push/subscribe", { method: "POST", body: "{}" }))).status).toBe(403);
  expect(mocks.upsert).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});
