import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { phoneMoreSections, phoneSheetTabs } from "@/lib/navigation/mobile-tabs";

/**
 * Admin phone More sheet (board "Admin phone", 2026-11): the fifth phone tab
 * replaces the drawer below 640px and must offer exactly what the rail offers.
 */
const identity = vi.hoisted(() => ({ role: "ADMIN" as string, pathname: "/v2/admin/cases", denied: [] as string[] }));
vi.mock("next/navigation", () => ({ usePathname: () => identity.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", name: "Office", role: identity.role } } }), signOut: vi.fn() }));
vi.mock("@/components/look-switch-link", () => ({ LookSwitchLink: () => null }));
vi.mock("@/components/v2/portal/role-switcher", () => ({ RoleSwitcher: () => null }));
vi.mock("@/components/shared/ops-access-provider", () => ({
  useOpsAccess: () => ({ canAccess: (href: string) => !identity.denied.includes(href), levels: null }),
}));

const icon = () => <span />;
const NAV: NavItem[] = [
  { href: "/v2/admin", label: "Command", icon, group: "Today" },
  { href: "/v2/admin/jobs", label: "Jobs", icon, group: "Today", badge: 3 },
  { href: "/v2/admin/calendar", label: "Calendar", icon, group: "Today" },
  { href: "/v2/admin/ops", label: "Live ops", icon, group: "Today" },
  { href: "/v2/admin/approvals", label: "Approvals", icon, group: "Today", badge: 12 },
  { href: "/v2/admin/cases", label: "Cases", icon, group: "Operations", badge: 2 },
  { href: "/v2/admin/laundry", label: "Laundry", icon, group: "Operations" },
  { href: "/v2/admin/properties", label: "Properties", icon, group: "Operations" },
  { href: "/v2/admin/accounts", label: "People", icon, group: "People and quality" },
  { href: "/v2/admin/finance", label: "Invoices and pay", icon, group: "Money" },
  { href: "/v2/admin/settings", label: "Settings", icon, group: "Setup" },
  { href: "/v2/admin/activity", label: "Activity log", icon, group: "Setup", adminOnly: true },
  { href: "/v2/admin/diagnostics", label: "Diagnostics", icon, group: "System", adminOnly: true },
];

beforeEach(() => {
  identity.role = "ADMIN";
  identity.pathname = "/v2/admin/cases";
  identity.denied = [];
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(accent: "admin" | "client" = "admin", nav: NavItem[] = NAV) {
  return render(<PortalShell accent={accent} wordmark="sNeek" nav={nav} roleLabel="Admin"><h1>Page</h1></PortalShell>);
}

async function openMore() {
  const tabs = screen.getByRole("navigation", { name: "Main tabs" });
  fireEvent.click(within(tabs).getByRole("button", { name: /^More/ }));
  return screen.findByRole("dialog", { name: "More" });
}

describe("admin phone tab bar", () => {
  it("has Command, Jobs, Calendar, Approvals and More, with the Approvals badge", () => {
    mount();
    const tabs = screen.getByRole("navigation", { name: "Main tabs" });
    expect(within(tabs).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/v2/admin", "/v2/admin/jobs", "/v2/admin/calendar", "/v2/admin/approvals"]);
    expect(within(tabs).getByRole("link", { name: /Approvals/ })).toHaveTextContent("9+");
    expect(within(tabs).getByRole("button", { name: /^More/ })).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("offers Sign out inside the sheet, because the rail's button is hidden on a phone", async () => {
    mount();
    const sheet = await openMore();
    const { signOut } = await import("next-auth/react");
    fireEvent.click(within(sheet).getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/v2/login" });
  });

  it("marks More when a page inside it needs attention and when the current page lives in it", () => {
    mount();
    const more = within(screen.getByRole("navigation", { name: "Main tabs" })).getByRole("button", { name: /^More/ });
    expect(more).toHaveTextContent("some pages need attention");
    expect(more.className).toContain("e-accent-portal");
  });

  it("shows no dot when nothing inside More has a badge", () => {
    mount("admin", NAV.map((item) => (item.href === "/v2/admin/cases" ? { ...item, badge: undefined } : item)));
    const more = within(screen.getByRole("navigation", { name: "Main tabs" })).getByRole("button", { name: /^More/ });
    expect(more).not.toHaveTextContent("need attention");
  });

  it("keeps the other portals' bars unchanged (no More sheet)", () => {
    mount("client", [{ href: "/v2/client", label: "Home", icon }, { href: "/v2/client/more", label: "More", icon, mobileOnly: true }]);
    expect(screen.queryByRole("navigation", { name: "Main tabs" })).toBeNull();
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });
});

describe("admin More sheet", () => {
  it("lists every rail destination that is not a tab, grouped like the rail, with badges", async () => {
    mount();
    const rail = screen.getByRole("navigation", { name: "Portal navigation" });
    const railHrefs = within(rail).getAllByRole("link").map((link) => link.getAttribute("href"));
    const sheet = await openMore();
    const tabHrefs = ["/v2/admin", "/v2/admin/jobs", "/v2/admin/calendar", "/v2/admin/approvals"];
    const sheetHrefs = within(sheet).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(sheetHrefs).toEqual(railHrefs.filter((href) => !tabHrefs.includes(href!)));
    const groups = within(sheet).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(groups).toEqual(["Today", "Operations", "People and quality", "Money", "Setup", "System"]);
    expect(within(sheet).getByRole("link", { name: /Cases/ })).toHaveTextContent("2");
    expect(within(sheet).getByRole("link", { name: /Cases/ })).toHaveAttribute("aria-current", "page");
  });

  it("hides admin-only and pack-blocked destinations exactly as the rail does", async () => {
    identity.role = "OPS_MANAGER";
    identity.denied = ["/v2/admin/laundry"];
    mount();
    const rail = screen.getByRole("navigation", { name: "Portal navigation" });
    for (const name of ["Activity log", "Diagnostics", "Laundry"]) expect(within(rail).queryByRole("link", { name })).toBeNull();
    const sheet = await openMore();
    for (const name of ["Activity log", "Diagnostics", "Laundry"]) expect(within(sheet).queryByRole("link", { name })).toBeNull();
    expect(within(sheet).getByRole("link", { name: "Properties" })).toBeInTheDocument();
  });

  it("filters with Find a page and says when nothing matches", async () => {
    mount();
    const sheet = await openMore();
    fireEvent.change(within(sheet).getByLabelText("Find a page"), { target: { value: "money" } });
    expect(within(sheet).getAllByRole("link").map((link) => link.textContent)).toEqual(["Invoices and pay"]);
    fireEvent.change(within(sheet).getByLabelText("Find a page"), { target: { value: "zzz" } });
    expect(within(sheet).getByRole("status")).toHaveTextContent("No matching pages");
  });

  it("closes on Escape and returns focus to the More tab", async () => {
    mount();
    const more = within(screen.getByRole("navigation", { name: "Main tabs" })).getByRole("button", { name: /^More/ });
    more.focus();
    fireEvent.click(more);
    const sheet = await screen.findByRole("dialog", { name: "More" });
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "More" })).toBeNull());
    expect(more).toHaveFocus();
  });
});

describe("phone More helpers", () => {
  it("picks only authorized tabs and groups the rest in rail order", () => {
    const tabs = phoneSheetTabs("admin", NAV.filter((item) => item.href !== "/v2/admin/calendar"));
    expect(tabs.map((tab) => tab.label)).toEqual(["Command", "Jobs", "Approvals"]);
    const sections = phoneMoreSections(tabs, NAV);
    expect(sections.flatMap((section) => section.items).map((item) => item.label)).toContain("Calendar");
    expect(phoneSheetTabs("client", NAV)).toEqual([]);
  });
});
