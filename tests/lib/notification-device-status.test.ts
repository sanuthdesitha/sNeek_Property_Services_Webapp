// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/push/status/route";
const mocks = vi.hoisted(() => ({ session: vi.fn(), count: vi.fn(), configured: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/db", () => ({ db: { pushSubscription: { count: mocks.count } } }));
vi.mock("@/lib/notifications/web-push", () => ({ isWebPushConfigured: mocks.configured }));
const request = (body: unknown) => POST(new Request("http://localhost/api/push/status", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: "user" } }); mocks.count.mockResolvedValue(1); mocks.configured.mockResolvedValue(true); });
it("checks only the current user's exact endpoint with private response", async () => {
  const result = await request({ endpoint: "https://push.test/device" });
  expect(await result.json()).toEqual({ configured: true, registered: true });
  expect(mocks.count).toHaveBeenCalledWith({ where: { userId: "user", endpoint: "https://push.test/device" } });
  expect(result.headers.get("cache-control")).toBe("private, no-store");
});
it("reports a missing browser subscription without querying other devices", async () => {
  expect(await (await request({ endpoint: null })).json()).toEqual({ configured: true, registered: false });
  expect(mocks.count).not.toHaveBeenCalled();
});
it.each([{}, { endpoint: "invalid" }, null])("rejects malformed status queries", async body => {
  expect((await request(body)).status).toBe(400); expect(mocks.count).not.toHaveBeenCalled();
});
it("hides private storage errors", async () => {
  mocks.count.mockRejectedValue(new Error("database credentials"));
  const response = await request({ endpoint: "https://push.test/device" });
  expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("credentials");
});
it("denies unauthenticated status queries", async () => {
  mocks.session.mockRejectedValue(new Error("UNAUTHORIZED"));
  expect((await request({ endpoint: null })).status).toBe(401);
});
