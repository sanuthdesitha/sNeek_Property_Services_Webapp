import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TypesTab } from "@/components/v2/admin/notifications/types-tab";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import { resolveNotificationsTab, notificationsTabHref } from "@/components/v2/admin/notifications/tabs";
import { manualReminderView } from "./notification-wording-fixtures";

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
    if (url === "/api/admin/notifications/wording") return Promise.resolve(new Response(JSON.stringify({ summaries: [{ typeKey: reminder.key, status: "EDITABLE", transports: ["INBOX", "EMAIL"], edited: false, problems: 0, liveVersion: 1 }], canEdit: true, editReason: null })));
    if (url.startsWith("/api/admin/notifications/wording/")) return Promise.resolve(new Response(JSON.stringify(manualReminderView())));
    if (url.startsWith("/api/admin/notifications/deliveries")) return Promise.resolve(new Response(JSON.stringify({ rows: [], total: 0, page: 1, pageSize: 20 })));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const props = { readOnly: false, timeZone: "Australia/Sydney", companyName: "sNeek", initialType: null };

it("lists types grouped by audience with transports and opens details, wording, switches, test send and recent deliveries", async () => {
  render(<TypesTab isAdmin {...props} />);
  const list = await screen.findByRole("region", { name: "Notification types" }).catch(() => screen.getByLabelText("Notification types"));
  expect(within(list).getByRole("heading", { name: /Cleaners/ })).toBeInTheDocument();
  fireEvent.click(within(list).getByRole("button", { name: reminder.name }));
  expect(await screen.findByRole("heading", { level: 2, name: reminder.name })).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: /Respect each person's own notification choices/ })).toHaveAttribute("aria-checked", "false");
  expect(await screen.findByLabelText("Inbox title")).toHaveValue("Unfinished job reminder");
  expect(screen.getByRole("button", { name: "Send test to me" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "More about this notification" }));
  expect(screen.getByRole("switch", { name: "Automatic email: job reminder" })).toHaveAttribute("aria-checked", "true");
  await waitFor(() => expect(screen.getByText(/No deliveries recorded for this type/)).toBeInTheDocument());
});

it("an operations manager sees switches but cannot change them", async () => {
  render(<TypesTab isAdmin={false} {...props} initialType={reminder.key} />);
  await waitFor(() => expect(screen.getByRole("switch", { name: /Respect each person's own notification choices/ })).toBeDisabled());
  expect(screen.getAllByText("Only administrators can change switches.").length).toBeGreaterThan(0);
});

it("keeps old links working: no tab opens Types and wording", () => {
  expect(resolveNotificationsTab(undefined)).toBe("types");
  expect(resolveNotificationsTab("bogus")).toBe("types");
  expect(resolveNotificationsTab("log")).toBe("log");
  expect(notificationsTabHref("types")).toBe("/v2/admin/notifications");
});
