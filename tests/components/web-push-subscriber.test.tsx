import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WebPushSubscriber } from "@/components/notifications/web-push-subscriber";
const auth = vi.hoisted(() => ({ user: { id: "one", role: "CLIENT" }, impersonation: undefined as unknown }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: auth }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const requestPermission = vi.fn();
const getSubscription = vi.fn();
const subscribe = vi.fn();
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); window.localStorage.clear(); auth.impersonation = undefined;
  vi.stubGlobal("Notification", { permission: "granted", requestPermission });
  vi.stubGlobal("PushManager", function () {});
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ active: {}, pushManager: { getSubscription, subscribe } }) } });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it("requires user action to repair granted permission without a subscription", async () => {
  getSubscription.mockResolvedValue(null);
  render(<WebPushSubscriber />);
  expect(await screen.findByRole("button", { name: "Enable" })).toBeVisible();
  expect(requestPermission).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});
it("does not silently rebind an existing device to the current account", async () => {
  getSubscription.mockResolvedValue({ endpoint: "https://push.test/device" });
  render(<WebPushSubscriber />);
  await waitFor(() => expect(getSubscription).toHaveBeenCalled());
  expect(fetchMock).not.toHaveBeenCalled(); expect(requestPermission).not.toHaveBeenCalled();
});
it("does not offer device mutations during impersonation", () => {
  auth.impersonation = { actorId: "admin" };
  render(<WebPushSubscriber />);
  expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  expect(getSubscription).not.toHaveBeenCalled();
});
