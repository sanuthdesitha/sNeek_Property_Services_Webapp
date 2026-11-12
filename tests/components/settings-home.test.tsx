/**
 * Settings home (2026-11 board): all catalog categories and destinations at
 * once, filtered by the same availableSettings rule as the navigation (an
 * operations manager never sees an admin-only destination), "Admin" marks for
 * administrators, badges only from server state, and search that also finds
 * settings on other pages.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsHome } from "@/components/v2/admin/settings/settings-home";
import { availableSettings, settingsHref, SETTINGS_GROUPS } from "@/components/v2/admin/settings/settings-catalog";
import { matchesSettingsQuery } from "@/lib/admin/settings-home-types";

afterEach(cleanup);

function renderHome(isAdmin: boolean, states = {}) {
  const destinations = availableSettings(isAdmin).map((tab) => ({ key: tab.key, label: tab.label, description: tab.description, group: tab.group, adminOnly: tab.adminOnly, href: settingsHref(tab.key) }));
  render(
    <SettingsHome
      groups={SETTINGS_GROUPS.map((group) => ({ key: group.key, label: group.label, description: group.description }))}
      destinations={destinations}
      isAdmin={isAdmin}
      states={states}
      recent={isAdmin ? [] : null}
      auditHref={isAdmin ? settingsHref("audit") : null}
      timezone="Australia/Sydney"
    />,
  );
  return destinations;
}

describe("Settings home", () => {
  it("shows every destination an administrator may open, grouped, with Admin marks", () => {
    const destinations = renderHome(true);
    for (const item of destinations) expect(screen.getAllByRole("link", { name: new RegExp(item.label.replace(/[()&]/g, ".")) }).length).toBeGreaterThan(0);
    const xero = screen.getByRole("link", { name: /^Xero/ });
    expect(within(xero).getByText("Admin")).toBeInTheDocument();
    expect(xero).toHaveAttribute("href", "/v2/admin/settings?tab=xero");
    expect(screen.getByRole("link", { name: /Access and permissions/ })).toHaveAttribute("href", "/v2/admin/settings/access");
  });

  it("never shows an operations manager an admin-only destination and shows no Admin marks", () => {
    renderHome(false);
    expect(screen.queryByRole("link", { name: /^Xero/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Cleaner rates/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Bank & payment/ })).toBeInTheDocument();
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recently changed" })).toBeNull();
  });

  it("shows a badge and a needs-attention line only for server state", () => {
    renderHome(true, { xero: { tone: "bad", text: "Reconnect", detail: "Xero sign-in lapsed." } });
    expect(within(screen.getByRole("link", { name: /^Xero/ })).getByText("Reconnect")).toBeInTheDocument();
    expect(screen.getByText("Xero sign-in lapsed.")).toBeInTheDocument();
    expect(screen.queryByText("SMS failing")).toBeNull();
  });

  it("searches names and descriptions, including settings on other pages", () => {
    renderHome(true);
    fireEvent.change(screen.getByLabelText("Search settings"), { target: { value: "rate" } });
    const results = screen.getByRole("region", { name: "Search results" });
    expect(within(results).getByRole("link", { name: /Rate card/ })).toHaveAttribute("href", "/v2/admin/quotes?tab=rate-card");
    expect(within(results).getByRole("link", { name: /Cleaner rates/ })).toBeInTheDocument();
    expect(matchesSettingsQuery("holiday money", "Public holiday rates", "x", "Money")).toBe(true);
    expect(matchesSettingsQuery("holiday quality", "Public holiday rates", "x", "Money")).toBe(false);
  });
});
