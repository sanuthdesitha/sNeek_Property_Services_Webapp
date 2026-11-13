/**
 * Settings home and the Activity log on a phone (board
 * "M-SettingsActivityGrowth", 2026-11): folding categories with every
 * destination still reachable, sentence rows opening a full-screen detail with
 * the actual person and the person they were testing as kept apart, filters
 * in one sheet and Export CSV in the "⋯" menu. Unchanged from 640px up.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsHome } from "@/components/v2/admin/settings/settings-home";
import { availableSettings, settingsHref, SETTINGS_GROUPS } from "@/components/v2/admin/settings/settings-catalog";
import { ActivityLog } from "@/components/v2/admin/activity/activity-log";
import type { ActivityPage } from "@/lib/admin/activity";

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderHome() {
  const destinations = availableSettings(true).map((tab) => ({ key: tab.key, label: tab.label, description: tab.description, group: tab.group, adminOnly: tab.adminOnly, href: settingsHref(tab.key) }));
  render(
    <SettingsHome
      groups={SETTINGS_GROUPS.map((group) => ({ key: group.key, label: group.label, description: group.description }))}
      destinations={destinations}
      isAdmin
      states={{ xero: { tone: "warn", text: "Expiring", detail: "Token expires Wed 18 Nov" } }}
      recent={[]}
      auditHref={settingsHref("audit")}
      timezone="Australia/Sydney"
    />,
  );
  return destinations;
}

describe("Settings home on a phone", () => {
  it("folds categories, keeps search and needs attention on screen, and every destination reachable", () => {
    setPhone(true);
    const destinations = renderHome();
    expect(screen.getByLabelText("Search settings")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Needs attention" })).getByText("Token expires Wed 18 Nov")).toBeInTheDocument();
    const toggles = SETTINGS_GROUPS.map((group) => screen.queryByRole("button", { name: new RegExp(`^${group.label.replace(/[()&]/g, ".")}`) })).filter((button): button is HTMLElement => button !== null);
    expect(toggles.length).toBeGreaterThan(0);
    for (const toggle of toggles) expect(toggle).toHaveAttribute("aria-expanded", "false");
    for (const toggle of toggles) fireEvent.click(toggle);
    for (const toggle of toggles) expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const item of destinations) expect(screen.getAllByRole("link", { name: new RegExp(item.label.replace(/[()&]/g, ".")) }).length).toBeGreaterThan(0);
  });

  it("from 640px up shows every category open with plain headings", () => {
    setPhone(false);
    renderHome();
    expect(screen.queryByRole("button", { name: /^Money/ })).toBeNull();
    expect(screen.getByRole("link", { name: /^Xero/ })).toBeInTheDocument();
  });
});

const page: ActivityPage = {
  rows: [{
    id: "a1", at: "2026-11-12T22:14:00.000Z", sentence: "Changed Priya Nair's access", entity: "Access", entityId: "ops-policy", jobId: null,
    actual: { name: "Ravi Mehta", role: "administrator" }, testingAs: { name: "Chloe Martin", role: "ops manager" },
    changes: [{ field: "Laundry", before: "Off", after: "View" }], before: { laundry: "off" }, after: { laundry: "read" }, ipAddress: null,
  }],
  total: 1, page: 1, pageSize: 50, pageCount: 1,
  counts: { all: 1, access: 1, money: 0, jobs: 0, settings: 0, testing: 1, system: 0 },
  entities: ["Access"],
} as unknown as ActivityPage;

describe("Activity log on a phone", () => {
  it("opens a row as a full-screen detail with the actual and the tested-as person apart", async () => {
    setPhone(true);
    render(<ActivityLog page={page} searchParams={{ entity: "Access" }} timezone="Australia/Sydney" />);
    fireEvent.click(await screen.findByRole("button", { name: /Changed Priya Nair's access/ }));
    const detail = screen.getByRole("dialog", { name: "Activity entry" });
    expect(detail).toHaveTextContent("Done byRavi Mehta, administrator");
    expect(detail).toHaveTextContent("Acting asTesting as Chloe Martin");
    expect(within(detail).getByRole("table", { name: "Changed fields" })).toHaveTextContent("LaundryOffView");
    expect(within(detail).getByText("Raw before and after")).toBeInTheDocument();
  });

  it("puts the filter form in one sheet and Export CSV in the menu", async () => {
    setPhone(true);
    render(<ActivityLog page={page} searchParams={{ entity: "Access" }} timezone="Australia/Sydney" />);
    expect(within(screen.getByRole("list", { name: "Active filters" })).getByText("Record type: Access")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter activity" });
    for (const label of ["Period", "Record type", "Person", "Action"]) expect(within(sheet).getByLabelText(label)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Apply" })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "More activity actions" }));
    expect(screen.getByRole("menuitem", { name: "Export CSV" })).toHaveAttribute("href", "/api/admin/activity/export?entity=Access");
  });

  it("from 640px up keeps the inline form, the Export link and disclosure rows", () => {
    setPhone(false);
    const { container } = render(<ActivityLog page={page} searchParams={{}} timezone="Australia/Sydney" />);
    expect(screen.getByLabelText("Person")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/admin/activity/export");
    expect(container.querySelector("details summary")).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
