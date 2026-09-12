import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationDeviceSettings } from "@/components/notifications/notification-device-settings";
const auth = vi.hoisted(() => ({ user: { id: "one", role: "CLIENT" }, impersonation: undefined as unknown }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: auth }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const fetchMock = vi.fn();
const requestPermission = vi.fn();
const getSubscription = vi.fn();
const subscribe = vi.fn();
const showNotification = vi.fn();
const unsubscribe = vi.fn();
const subscription = { endpoint: "https://push.test/device", toJSON: () => ({ endpoint: "https://push.test/device", keys: { auth: "auth", p256dh: "key" } }), unsubscribe };
const ok = (body: unknown) => ({ ok: true, json: async () => body });
beforeEach(() => {
  vi.resetAllMocks();
  auth.user = { id: "one", role: "CLIENT" }; auth.impersonation = undefined;
  vi.stubGlobal("Notification", { permission: "granted", requestPermission });
  vi.stubGlobal("PushManager", function () {});
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ active: {}, pushManager: { getSubscription, subscribe }, showNotification }) } });
  getSubscription.mockResolvedValue(subscription);
  subscribe.mockResolvedValue(subscription);
  unsubscribe.mockResolvedValue(true);
  fetchMock.mockImplementation(async (url: string) => url === "/api/public/push-config" ? ok({ vapidPublicKey: "AQID" }) : ok({ registered: true, configured: true, ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Notification settings and device" }));
  await screen.findByText("Registered to this account");
}
it("only inspects on opening and reports separate device facts", async () => {
  render(<NotificationDeviceSettings />); await open();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/push/status");
  expect(requestPermission).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled(); expect(showNotification).not.toHaveBeenCalled();
  expect(screen.getByText("Server push configuration")).toBeVisible();
});
it("registers only on user gesture without claiming delivery", async () => {
  render(<NotificationDeviceSettings />); await open();
  fireEvent.click(screen.getByRole("button", { name: "Enable or repair" }));
  await screen.findByText("Registration saved. This does not confirm delivery of a notification.");
  expect(fetchMock.mock.calls.some(call => call[0] === "/api/push/subscribe")).toBe(true);
});
it("runs a local display test only on request and labels its limit", async () => {
  render(<NotificationDeviceSettings />); await open();
  fireEvent.click(screen.getByRole("button", { name: "Test local display" }));
  await screen.findByText(/Browser accepted the local display test/);
  expect(showNotification).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.some(call => call[0] === "/api/push/test")).toBe(false);
});
it("shows blocked permission guidance and disables setup", async () => {
  vi.stubGlobal("Notification", { permission: "denied", requestPermission });
  render(<NotificationDeviceSettings />); await open();
  expect(screen.getByRole("button", { name: "Enable or repair" })).toBeDisabled();
  expect(screen.getByText(/Notifications are blocked/)).toBeVisible();
});
it("does not mutate devices while impersonating", async () => {
  auth.impersonation = { actorId: "admin" };
  render(<NotificationDeviceSettings />); await open();
  for (const name of ["Enable or repair", "Remove this device", "Test local display"]) expect(screen.getByRole("button", { name })).toBeDisabled();
});
it("retains subscription when server unregister fails", async () => {
  render(<NotificationDeviceSettings />); await open();
  fetchMock.mockResolvedValueOnce({ ok: false });
  fireEvent.click(screen.getByRole("button", { name: "Remove this device" }));
  await screen.findByRole("alert");
  expect(unsubscribe).not.toHaveBeenCalled();
});
it("discards pending registration after account changes", async () => {
  let resolve!: (value: NotificationPermission) => void;
  requestPermission.mockReturnValue(new Promise(done => { resolve = done; }));
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  const view = render(<NotificationDeviceSettings />); await open();
  fireEvent.click(screen.getByRole("button", { name: "Enable or repair" }));
  auth.user = { id: "two", role: "CLIENT" }; view.rerender(<NotificationDeviceSettings />);
  await act(async () => resolve("granted"));
  await waitFor(() => expect(fetchMock.mock.calls.filter(call => call[0] === "/api/push/status")).toHaveLength(2));
  expect(fetchMock.mock.calls.some(call => call[0] === "/api/push/subscribe")).toBe(false);
});
