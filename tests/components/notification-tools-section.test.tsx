import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationToolsSection } from "@/components/v2/admin/settings/notification-tools-section";
const m = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: m.toast }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function setup(testOutcome = { ok: true }) {
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") return { ok: testOutcome.ok, json: async () => testOutcome };
    if (url === "/api/admin/settings") return { ok: true, json: async () => ({ smsProvider: "cellcast" }) };
    if (url === "/api/admin/notifications/dispatch-status") return { ok: true, json: async () => ({ worker: { status: "MISSING", mobileDispatcherActive: false }, hasMore: false, mobile: [], attempts: [] }) };
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetch); render(<NotificationToolsSection />); return fetch;
}
it("loads provider and delivery review using reads only until the operator explicitly sends a test", async () => {
  const fetch = setup();
  expect(await screen.findByText("SMS active: Cellcast")).toBeVisible();
  expect(await screen.findByRole("alert")).toHaveTextContent("No dedicated worker heartbeat");
  expect(fetch.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
  expect(screen.getByRole("button", { name: "Send test" })).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText("name@example.com"), { target: { value: " operator@example.invalid " } });
  fireEvent.click(screen.getByRole("button", { name: "Send test" }));
  await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Test sent" })));
  expect(fetch).toHaveBeenCalledWith("/api/admin/notifications/test", expect.objectContaining({ method: "POST", body: JSON.stringify({ to: "operator@example.invalid", channel: "EMAIL" }) }));
});
it("shows failed test delivery and permits correction without automatically retrying", async () => {
  const fetch = setup({ ok: false });
  await screen.findByText("SMS active: Cellcast");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "SMS" } });
  fireEvent.change(screen.getByPlaceholderText("+61400000000"), { target: { value: "+61400000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Send test" }));
  await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Test failed", variant: "destructive" })));
  expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Send test" })).toBeEnabled();
});
