import React from "react";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { mobileTabs } from "@/lib/navigation/mobile-tabs";
import { withQuery } from "@/lib/navigation/redirect-query";
import {
  CLIENT_RAIL, CLIENT_REQUEST_ITEMS, CLIENT_TABS, moreSectionsFor, requestItemsFor, type ClientNavViewer,
} from "@/components/v2/client/portal/portal-nav";

const route = vi.hoisted(() => ({ pathname: "/v2/client", redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, redirect: route.redirect }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "client-1", name: "Alex", role: "CLIENT" } } }), signOut: vi.fn() }));
vi.mock("@/components/look-switch-link", () => ({ LookSwitchLink: () => null }));
vi.mock("@/components/v2/portal/role-switcher", () => ({ RoleSwitcher: () => null }));
vi.mock("@/components/v2/portal/notification-inbox", () => ({ NotificationInbox: () => null }));
vi.mock("@/components/v2/portal/portal-search", () => ({ PortalSearch: () => null }));

const CLIENT: ClientNavViewer = { actor: "CLIENT", permissions: {} };
const VA = (permissions: Record<string, boolean> = {}, modules?: ClientNavViewer["modules"]): ClientNavViewer =>
  ({ actor: "VA", permissions, modules });

function hrefsOf(viewer: ClientNavViewer): string[] {
  return moreSectionsFor(viewer).flatMap((section) => section.rows.flatMap((row) => row.links.map((link) => link.href)));
}

beforeEach(() => {
  route.pathname = "/v2/client";
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("client phone tabs", () => {
  it("renders Home, Cleans, Approvals, Money and More in the drawn order", () => {
    const icon = () => <span />;
    const nav: NavItem[] = [
      ...CLIENT_RAIL.map((item) => ({ href: item.href, label: item.label, icon, group: item.group })),
      { href: "/v2/client/more", label: "More", icon, mobileOnly: true },
    ];
    expect(mobileTabs("client", nav).map((item) => item.label)).toEqual(["Home", "Cleans", "Approvals", "Money", "More"]);
    expect(CLIENT_TABS.map((tab) => tab.label)).toEqual(["Home", "Cleans", "Approvals", "Money", "More"]);
    render(<PortalShell accent="client" wordmark="sNeek" nav={nav} hideMobileMenuButton headerActions={<button>Request</button>}><h1>Home</h1></PortalShell>);
    // The More tab is phone-only: never in the desktop rail.
    const rail = screen.getByRole("navigation", { name: "Portal navigation" });
    expect(within(rail).queryByRole("link", { name: "More" })).toBeNull();
    expect(screen.getByRole("link", { name: "More" })).toHaveAttribute("href", "/v2/client/more");
    // Header controls supplied by the client layout render in the shell header.
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Request" })).toBeVisible();
    // No drawer button on the phone: More replaces it (Tailwind classes are not applied in jsdom).
    expect(screen.getByRole("button", { name: "Menu" }).className).toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("keeps the Money tab lit on the retired /money URL and Approvals on quotes", () => {
    expect(CLIENT_TABS.find((tab) => tab.label === "Money")!.activePrefixes).toContain("/v2/client/money");
    expect(CLIENT_TABS.find((tab) => tab.label === "Approvals")!.activePrefixes).toContain("/v2/client/quotes");
  });
});

describe("every client destination keeps a home", () => {
  it("maps every route under app/v2/client to the rail, More, the request sheet, a tab or a redirect", () => {
    const root = join(process.cwd(), "app/v2/client");
    const routes = readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
    const reachable = new Set([
      ...CLIENT_RAIL.map((item) => item.href),
      ...CLIENT_TABS.map((tab) => tab.href),
      ...hrefsOf(CLIENT),
      ...CLIENT_REQUEST_ITEMS.map((item) => item.href),
    ]);
    // Detail-only routes (reached from a list or a notification) and retired redirects.
    const viaDetailOrRedirect = new Set(["damage", "disputes", "money", "services"]);
    const missing = routes.filter((name) => !viaDetailOrRedirect.has(name) && !reachable.has(`/v2/client/${name}`));
    expect(missing).toEqual([]);
  });

  it("lists the drawn More groups for the account holder, with paired rows", () => {
    const sections = moreSectionsFor(CLIENT);
    expect(sections.map((section) => section.title)).toEqual(["Your cleans", "Your homes", "Support, billing, account"]);
    const labels = sections.map((section) => section.rows.map((row) => row.links.map((link) => link.label).join(" · ")));
    expect(labels).toEqual([
      ["Cleans list", "Calendar", "Reports", "Laundry"],
      ["Properties", "Inventory", "Shopping · Stock counts", "Maintenance"],
      ["Cases and disputes", "My quotes", "Referrals · Assistants", "Profile · Settings"],
    ]);
  });

  it("offers the seven drawn requests to the account holder", () => {
    expect(requestItemsFor(CLIENT).map((item) => item.label)).toEqual([
      "Book a clean", "Rebook a previous clean", "Extra task or add-on", "Request a quote",
      "Something needs fixing", "Raise an issue or dispute", "Start a shopping run or stock count",
    ]);
  });
});

describe("assistant limits", () => {
  it("shows an assistant with no grants only the destinations any assistant may open", () => {
    expect(hrefsOf(VA())).toEqual(["/v2/client/jobs", "/v2/client/calendar", "/v2/client/laundry"]);
    expect(requestItemsFor(VA())).toEqual([]);
  });

  it("never offers money decisions or account management, whatever the grants", () => {
    const all = VA({ bookings: true, maintenance: true, reports: true, damage: true, invoicesView: true, messages: true, properties: true, tasksCreate: true });
    const hrefs = hrefsOf(all);
    for (const forbidden of ["approvals", "quotes", "shopping", "stock-runs", "referrals", "team", "profile", "settings"]) {
      expect(hrefs).not.toContain(`/v2/client/${forbidden}`);
    }
    expect(CLIENT_RAIL.filter((item) => item.gate === "client").map((item) => item.href)).toEqual(expect.arrayContaining([
      "/v2/client/approvals", "/v2/client/quotes", "/v2/client/team",
    ]));
    expect(requestItemsFor(all).map((item) => item.key)).toEqual(["book", "rebook", "addon", "fix", "case"]);
  });

  it("grants each destination independently", () => {
    expect(hrefsOf(VA({ properties: true }))).toEqual(expect.arrayContaining(["/v2/client/properties", "/v2/client/inventory"]));
    expect(hrefsOf(VA({ properties: true }))).not.toContain("/v2/client/reports");
    expect(hrefsOf(VA({ reports: true }))).toContain("/v2/client/reports");
    expect(requestItemsFor(VA({ bookings: true })).map((item) => item.key)).toEqual(["book", "rebook"]);
  });
});

describe("module switches", () => {
  it("hides destinations whose module is off for this client and keeps the rest", () => {
    const viewer: ClientNavViewer = { actor: "CLIENT", permissions: {}, modules: { laundry: false, reports: false, shopping: false, stockRuns: true } };
    const hrefs = hrefsOf(viewer);
    expect(hrefs).not.toContain("/v2/client/laundry");
    expect(hrefs).not.toContain("/v2/client/reports");
    expect(hrefs).not.toContain("/v2/client/shopping");
    expect(hrefs).toContain("/v2/client/stock-runs");
    // The sheet's shopping entry falls back to stock counts.
    expect(requestItemsFor(viewer).find((item) => item.key === "shopping")?.href).toBe("/v2/client/stock-runs");
  });

  it("does not hide anything while module switches are unknown", () => {
    expect(hrefsOf({ actor: "CLIENT", permissions: {}, modules: null })).toEqual(hrefsOf(CLIENT));
  });
});

describe("retired URLs keep their query strings", () => {
  it("builds redirect targets with every query value", () => {
    expect(withQuery("/v2/client/finance", { tab: "rates", paid: "1" })).toBe("/v2/client/finance?tab=rates&paid=1");
    expect(withQuery("/v2/client/cases", { id: ["a", "b"], empty: undefined })).toBe("/v2/client/cases?id=a&id=b");
    expect(withQuery("/v2/client/jobs", undefined)).toBe("/v2/client/jobs");
  });

  it.each([
    ["money", "/v2/client/finance"],
    ["services", "/v2/client/jobs"],
    ["disputes", "/v2/client/cases"],
  ])("redirects /v2/client/%s with the query", async (name, target) => {
    const page = (await import(`@/app/v2/client/${name}/page`)).default as (props: { searchParams: Record<string, string> }) => unknown;
    await page({ searchParams: { tab: "x" } });
    expect(route.redirect).toHaveBeenLastCalledWith(`${target}?tab=x`);
  });
});
