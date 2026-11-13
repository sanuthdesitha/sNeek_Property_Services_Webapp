/**
 * Notifications on a phone (board "M-Notifications", 2026-11): type list →
 * type screen → wording editor as stacked screens with back buttons, the
 * draft kept across screens, the preview and test send under the editor,
 * the delivery log filters in one sheet, and nothing changed from 640px up.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypesTab } from "@/components/v2/admin/notifications/types-tab";
import { DeliveryLogTab } from "@/components/v2/admin/notifications/delivery-log-tab";
import { NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import { manualReminderView } from "./notification-wording-fixtures";

const reminder = NOTIFICATION_CATALOG.find((entry) => entry.key === "job.reminder.manual")!;
const types = [{
  ...reminder,
  resolvedSwitches: [{ id: "email:job_reminder", label: "Automatic email: job reminder", enabled: true, editable: true, href: null, note: null }],
  respectsPreferencesNow: false, disabledTransports: [], externalPaths: { EMAIL: "direct", WEB_PUSH: "direct" }, templateHref: null,
}];
const fetchMock = vi.fn();

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => {
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith("/api/admin/notifications/catalog")) return Promise.resolve(new Response(JSON.stringify({ types, controlsUpdatedAt: null })));
    if (url === "/api/admin/notifications/wording") return Promise.resolve(new Response(JSON.stringify({ summaries: [], canEdit: true, editReason: null })));
    if (url.startsWith("/api/admin/notifications/wording/")) return Promise.resolve(new Response(JSON.stringify(manualReminderView())));
    if (url.startsWith("/api/admin/notifications/deliveries")) return Promise.resolve(new Response(JSON.stringify({ rows: [], total: 0, page: 1, pageSize: 25 })));
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const props = { readOnly: false, timeZone: "Australia/Sydney", companyName: "sNeek", initialType: null };

describe("Notifications types on a phone", () => {
  it("moves list → type → editor and back, keeping the draft, with preview and test send under the editor", async () => {
    setPhone(true);
    render(<TypesTab isAdmin {...props} />);
    const list = await screen.findByRole("region", { name: "Notification types" });
    expect(screen.queryByRole("heading", { level: 2, name: reminder.name })).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: reminder.name }));

    // Type screen: details and switches, a row per transport's wording, no editor yet.
    expect(await screen.findByRole("heading", { level: 2, name: reminder.name })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Notification types" })).toBeNull();
    expect(screen.getByRole("switch", { name: /Respect each person's own notification choices/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Inbox title")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Inbox wording/ }));

    // Editor screen: fields, preview and test send; details hidden.
    const title = await screen.findByLabelText("Inbox title");
    expect(screen.queryByRole("heading", { level: 2, name: reminder.name })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send test to me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Regenerate wording/ })).toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Please finish your job" } });

    fireEvent.click(screen.getByRole("button", { name: "Back to this notification" }));
    expect(screen.getByRole("button", { name: /Inbox wording/ })).toHaveTextContent("unsaved changes");
    fireEvent.click(screen.getByRole("button", { name: /Inbox wording/ }));
    expect(await screen.findByLabelText("Inbox title")).toHaveValue("Please finish your job");

    fireEvent.click(screen.getByRole("button", { name: "Back to this notification" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to notification types" }));
    expect(screen.getByRole("region", { name: "Notification types" })).toBeInTheDocument();
  });

  it("opens a deep-linked type on its type screen", async () => {
    setPhone(true);
    render(<TypesTab isAdmin {...props} initialType={reminder.key} />);
    expect(await screen.findByRole("heading", { level: 2, name: reminder.name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to notification types" })).toBeInTheDocument();
  });

  it("from 640px up shows list, details, editor and preview together", async () => {
    setPhone(false);
    render(<TypesTab isAdmin {...props} initialType={reminder.key} />);
    expect(await screen.findByLabelText("Inbox title")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Notification types" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: reminder.name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
  });
});

describe("Delivery log on a phone", () => {
  it("puts every filter in one sheet and shows applied ones as removable chips", async () => {
    setPhone(true);
    render(<DeliveryLogTab readOnly={false} onToast={vi.fn()} timeZone="Australia/Sydney" />);
    expect(screen.queryByLabelText("Recipient")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter deliveries" });
    for (const label of ["Type", "State", "Transport", "Recipient", "From", "To", "Source"]) expect(within(sheet).getByLabelText(label)).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText("Recipient"), { target: { value: "marco" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Apply filters" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    const chips = await screen.findByRole("list", { name: "Active filters" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("recipient=marco"))).toBe(true);
    fireEvent.click(within(chips).getByRole("button", { name: "Remove filter Recipient: marco" }));
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
    // Clear log stays reachable.
    expect(screen.getByRole("button", { name: /Clear log/ })).toBeInTheDocument();
  });
});
