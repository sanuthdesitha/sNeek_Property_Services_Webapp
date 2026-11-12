/**
 * Builds a portal's navigation list for `PortalShell` from a desktop rail and a
 * five-tab phone bar (QA and maintenance portals, 2026-11; same shape the
 * cleaner layout builds by hand).
 *
 * - Rail entries that are also tabs carry the tab's sub-paths, so the phone tab
 *   stays lit on its sub-pages.
 * - Tabs with no rail entry (More) are phone-only.
 * - Badges come from real counts only; a missing or zero count shows nothing.
 *
 * Plain module: no React, no "use client".
 */
import type { PortalRailItem, PortalTab } from "@/lib/navigation/portal-more";

export interface TabbedNavItem {
  href: string;
  label: string;
  icon: PortalRailItem["icon"];
  group?: string;
  badge?: number;
  mobileOnly?: boolean;
  tabActivePrefixes?: string[];
}

function withBadge(item: TabbedNavItem, count: number | undefined): TabbedNavItem {
  return count && count > 0 ? { ...item, badge: count } : item;
}

export function buildTabbedNav(options: {
  rail: readonly PortalRailItem[];
  tabs: readonly PortalTab[];
  /** Rail entries that exist only for some viewers (maintenance while assigned). */
  extra?: readonly PortalRailItem[];
  /** Real counts keyed by href. */
  badges?: Readonly<Record<string, number | undefined>>;
}): TabbedNavItem[] {
  const badges = options.badges ?? {};
  const railEntries = [...options.rail, ...(options.extra ?? [])];
  const rail = railEntries.map((item) => {
    const tab = options.tabs.find((candidate) => candidate.href === item.href);
    const base: TabbedNavItem = { href: item.href, label: item.label, icon: item.icon, group: item.group };
    return withBadge(tab ? { ...base, tabActivePrefixes: tab.activePrefixes } : base, badges[item.href]);
  });
  const phoneOnly = options.tabs
    .filter((tab) => !railEntries.some((item) => item.href === tab.href))
    .map((tab) =>
      withBadge(
        { href: tab.href, label: tab.label, icon: tab.icon, mobileOnly: true, tabActivePrefixes: tab.activePrefixes },
        badges[tab.href],
      ),
    );
  return [...rail, ...phoneOnly];
}
