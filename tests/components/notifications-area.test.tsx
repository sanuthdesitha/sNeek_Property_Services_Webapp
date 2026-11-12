import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TypesTab } from "@/components/v2/admin/notifications/types-tab";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import { resolveNotificationsTab, notificationsTabHref } from "@/components/v2/admin/notifications/tabs";

const fetchMock = vi.fn();
const reminder = NOTIFICATION_CATALOG.find((entry) => entry.key === "job.reminder.manual")!;
const types = [{
  ...reminder,
  resolvedSwitches: [{ id: "email:job_reminder", label: "Automatic email: job reminder", enabled: true, editable: true, href: null, note: null }],
  respectsPreferencesNow: false, disabledTransports: [], externalPaths: { EMAIL: "direct", WEB_PUSH: "direct" }, templateHref: null,
}];

beforeEach(() => {
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith("/api/admin/notifications/catalog")) return Promise.resolve(new Response(JSON.stringify({ types, controlsUpdatedAt: null })));
    if (url.startsWith("/api/admin/notifications/deliveries")) return Promise.resolve(new Response(JSON.stringify({ rows: [], total: 0, page: 1, pageSize: 20 })));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("lists types with their path and opens a panel with switches, test send and recent deliveries", async () => {
  render(<TypesTab isAdmin readOnly={false} />);
  const button = await screen.findByRole("button", { name: reminder.name });
  expect(screen.getByText("Pipeline (direct fallback)")).toBeInTheDocument();
  fireEvent.click(button);
  expect(await screen.findByRole("switch", { name: /Respect personal preferences/ })).toHaveAttribute("aria-checked", "false");
  expect(screen.getByRole("switch", { name: "Automatic email: job reminder" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: "Send test to me" })).toBeEnabled();
  await waitFor(() => expect(screen.getByText(/No deliveries recorded for this type/)).toBeInTheDocument());
});

it("an operations manager sees switches but cannot change them", async () => {
  render(<TypesTab isAdmin={false} readOnly={false} />);
  fireEvent.click(await screen.findByRole("button", { name: reminder.name }));
  await waitFor(() => expect(screen.getByRole("switch", { name: /Respect personal preferences/ })).toBeDisabled());
  expect(screen.getByText("Only administrators can change switches.")).toBeInTheDocument();
});

it("keeps old links working: no tab opens Types", () => {
  expect(resolveNotificationsTab(undefined)).toBe("types");
  expect(resolveNotificationsTab("bogus")).toBe("types");
  expect(resolveNotificationsTab("log")).toBe("log");
  expect(notificationsTabHref("types")).toBe("/v2/admin/notifications");
});
