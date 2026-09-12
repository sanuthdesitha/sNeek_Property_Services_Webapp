import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";

const identity = vi.hoisted(() => ({ id: "test-admin" as string | null, pathname: "/v2/admin/jobs" }));
vi.mock("next/navigation", () => ({ usePathname: () => identity.pathname }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: identity.id ? { user: { id: identity.id, name: "Test Admin" } } : null }), signOut: vi.fn() }));
vi.mock("@/components/look-switch-link", () => ({ LookSwitchLink: () => null }));
vi.mock("@/components/v2/portal/role-switcher", () => ({ RoleSwitcher: () => null }));
const icon = () => <span />;
const nav = [
  { href: "/v2/admin", label: "Command", icon, group: "Daily" },
  { href: "/v2/admin/jobs", label: "Jobs", icon, group: "Daily" },
  { href: "/v2/admin/settings", label: "Settings", icon, group: "Configuration" },
];
beforeEach(() => {
  identity.id = "test-admin";
  identity.pathname = "/v2/admin/jobs";
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function shell(accent: "admin" | "client" = "admin", entries: NavItem[] = nav) {
  return <PortalShell accent={accent} wordmark="sNeek" nav={entries} roleLabel="Admin"><h1>Jobs</h1></PortalShell>;
}
function mount() { return render(shell()); }

describe("portal navigation", () => {
  it("collapses with keyboard controls and remembers groups separately from favorites", async () => {
    const user = userEvent.setup();
    const view = mount();
    const button = screen.getByRole("button", { name: "Configuration" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(button.getAttribute("aria-controls")!);
    expect(panel).toContainElement(screen.getByRole("link", { name: "Settings" }));
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
    expect(localStorage.getItem("sneek:nav-groups:test-admin:admin")).toBe('["Configuration"]');
    expect(localStorage.getItem("sneek:nav-favorites:test-admin:admin")).toBeNull();
    view.unmount();
    mount();
    const restored = screen.getByRole("button", { name: "Configuration" });
    expect(restored).toHaveAttribute("aria-expanded", "false");
    restored.focus();
    await user.keyboard(" ");
    expect(restored).toHaveAttribute("aria-expanded", "true");
  });
  it("temporarily exposes search matches without changing collapsed preferences", () => {
    localStorage.setItem("sneek:nav-groups:test-admin:admin", '["Configuration"]');
    mount();
    const search = screen.getByRole("searchbox");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    for (const value of ["settings", "configuration"]) {
      fireEvent.change(search, { target: { value } });
      expect(screen.getByRole("link", { name: "Settings" })).toBeVisible();
      const group = screen.getByRole("button", { name: "Configuration" });
      expect(group).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(group);
      expect(screen.getByRole("link", { name: "Settings" })).toBeVisible();
      expect(localStorage.getItem("sneek:nav-groups:test-admin:admin")).toBe('["Configuration"]');
    }
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-expanded", "false");
  });
  it("reveals the active route on arrival but allows an explicit collapse", () => {
    localStorage.setItem("sneek:nav-groups:test-admin:admin", '["Daily","Configuration"]');
    const view = mount();
    const daily = screen.getByRole("button", { name: "Daily" });
    expect(daily).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(daily);
    expect(daily).toHaveAttribute("aria-expanded", "false");
    identity.pathname = "/v2/admin/settings/details";
    view.rerender(shell());
    expect(screen.getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-expanded", "true");
    identity.pathname = "/v2/admin/jobs";
    view.rerender(shell());
    expect(daily).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem("sneek:nav-groups:test-admin:admin")).toBe('["Daily","Configuration"]');
  });
  it("keeps ungrouped daily links visible when favorites and named groups collapse", () => {
    localStorage.setItem("sneek:nav-favorites:test-admin:admin", '["/v2/admin/settings","/v2/admin/settings","/unauthorized"]');
    localStorage.setItem("sneek:nav-groups:test-admin:admin", '["Favorites","Configuration","Daily work"]');
    render(shell("admin", nav.map((item) => item.group === "Daily" ? { ...item, group: undefined } : item)));
    const rail = screen.getByRole("navigation", { name: "Portal navigation" });
    expect(within(rail).getByRole("link", { name: "Jobs" })).toBeVisible();
    expect(within(rail).getByRole("link", { name: "Command" })).toBeVisible();
    expect(within(rail).queryByRole("button", { name: "Daily work" })).toBeNull();
    fireEvent.click(within(rail).getByRole("button", { name: "Favorites" }));
    expect(within(rail).getAllByRole("link", { name: "Settings" })).toHaveLength(1);
    expect(rail.querySelector('a[href="/unauthorized"]')).toBeNull();
    fireEvent.click(within(rail).getByRole("button", { name: "Unpin Settings" }));
    expect(within(rail).getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-expanded", "false");
  });
  it("reloads preferences when user or portal changes and isolates signed-out state", () => {
    localStorage.setItem("sneek:nav-groups:test-admin:admin", '["Configuration"]');
    localStorage.setItem("sneek:nav-groups:other-user:client", '["Configuration"]');
    const view = mount();
    expect(screen.getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-expanded", "false");
    identity.id = "other-user";
    view.rerender(shell());
    expect(screen.getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-expanded", "true");
    view.rerender(shell("client"));
    expect(screen.getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Configuration" }));
    expect(localStorage.getItem("sneek:nav-groups:other-user:client")).toBe("[]");
    expect(localStorage.getItem("sneek:nav-groups:test-admin:admin")).toBe('["Configuration"]');
    identity.id = null;
    view.rerender(shell());
    expect(screen.getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Configuration" }));
    identity.id = "other-user";
    view.rerender(shell());
    expect(screen.getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem("sneek:nav-groups:other-user:admin")).toBeNull();
  });
  it.each(["not-json", "null", '{"Configuration":true}', '[null,1,{},"Unknown"]'])("ignores invalid group storage: %s", (stored) => {
    localStorage.setItem("sneek:nav-groups:test-admin:admin", stored);
    mount();
    expect(screen.getByRole("button", { name: "Configuration" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "Unknown" })).toBeNull();
  });
  it("keeps collapse usable when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    mount();
    const group = screen.getByRole("button", { name: "Configuration" });
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");
  });
  it("shares collapse state with the drawer using distinct control targets", async () => {
    const user = userEvent.setup();
    mount();
    const desktopGroup = screen.getByRole("button", { name: "Configuration" });
    fireEvent.click(desktopGroup);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    const dialog = screen.getByRole("dialog", { name: "Admin navigation" });
    const drawerGroup = within(dialog).getByRole("button", { name: "Configuration" });
    expect(drawerGroup).toHaveAttribute("aria-expanded", "false");
    expect(drawerGroup.getAttribute("aria-controls")).not.toBe(desktopGroup.getAttribute("aria-controls"));
    expect(dialog).toContainElement(document.getElementById(drawerGroup.getAttribute("aria-controls")!));
    await user.click(drawerGroup);
    expect(desktopGroup).toHaveAttribute("aria-expanded", "true");
    const settings = within(dialog).getByRole("link", { name: "Settings" });
    settings.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await user.click(settings);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("pins a page without duplicating it and persists the preference", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Pin Settings" }));
    const rail = screen.getByRole("navigation", { name: "Portal navigation" });
    expect(within(rail).getAllByRole("link")[0]).toHaveTextContent("Settings");
    expect(within(rail).getAllByRole("link", { name: "Settings" })).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("sneek:nav-favorites:test-admin:admin")!)).toEqual(["/v2/admin/settings"]);
    fireEvent.click(screen.getByRole("button", { name: "Unpin Settings" }));
    expect(within(rail).getAllByRole("link")[0]).toHaveTextContent("Command");
  });
  it("never renders saved favorites outside the authorized navigation", () => {
    localStorage.setItem("sneek:nav-favorites:test-admin:admin", JSON.stringify(["/v2/admin/secrets"]));
    mount();
    expect(document.querySelector('a[href="/v2/admin/secrets"]')).toBeNull();
  });
  it("recovers from malformed stored preferences", () => {
    localStorage.setItem("sneek:nav-favorites:test-admin:admin", "not-json");
    mount();
    expect(screen.getByRole("button", { name: "Pin Settings" })).toBeVisible();
  });
  it("does not import another user's favorites", () => {
    localStorage.setItem("sneek:nav-favorites:other-user:admin", JSON.stringify(["/v2/admin/settings"]));
    mount();
    expect(screen.getByRole("button", { name: "Pin Settings" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Unpin Settings" })).toBeNull();
  });
  it("filters by label and group and exposes empty results", () => {
    mount();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "configuration" } });
    const rail = screen.getByRole("navigation", { name: "Portal navigation" });
    expect(within(rail).getByRole("link", { name: "Settings" })).toBeVisible();
    expect(within(rail).queryByRole("link", { name: "Jobs" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unknown-page" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matching pages");
  });
  it("names the drawer, closes with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    mount();
    const menu = screen.getByRole("button", { name: "Menu" });
    await user.click(menu);
    const dialog = screen.getByRole("dialog", { name: "Admin navigation" });
    expect(within(dialog).getByRole("button", { name: "Close navigation" })).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(menu).toHaveFocus();
  });
  it("marks active navigation without adding settings to mobile tabs", () => {
    mount();
    expect(screen.getAllByRole("link", { name: "Jobs" }).every((link) => link.getAttribute("aria-current") === "page")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(1);
  });
});
