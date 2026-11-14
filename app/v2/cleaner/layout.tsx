"use client";

import * as React from "react";
import { tourTarget } from "@/lib/tutorials/targets";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { LocationTracker } from "@/components/v2/cleaner/location-tracker";
import { useMaintenanceSection } from "@/components/v2/portal/use-maintenance-section";
import { useAttentionCounts } from "@/components/v2/portal/use-attention-counts";
import { useOpenAskCount } from "@/components/v2/cleaner/portal/use-open-ask-count";
import { cleanerTabBadges } from "@/components/v2/cleaner/portal/tab-badges";
import {
  CLEANER_MAINTENANCE_RAIL_ITEM,
  CLEANER_RAIL,
  CLEANER_TABS,
  isCleanerJobScreen,
} from "@/components/v2/cleaner/portal/portal-nav";

/**
 * Cleaner portal shell (approved board "Cleaner portal", 2026-11).
 *
 * Phone: five tabs — Today, Jobs, Supplies, Pay, More. The More tab is the
 * labelled, role-filtered menu that replaces the drawer, so the phone header
 * carries only search and notifications. Inside one job the header and tabs
 * hide so the job's own bottom button is the next step.
 *
 * Desktop: the grouped rail lists every destination, unchanged in reach.
 */
function withBadge(item: NavItem, count: number | undefined): NavItem {
  return count && count > 0 ? { ...item, badge: count } : item;
}

export default function V2CleanerLayout({ children }: { children: React.ReactNode }) {
  // One fetch, refreshed on an interval and on focus. A failure leaves the
  // counts empty and therefore renders no pills.
  const attention = useAttentionCounts("/api/cleaner/attention-counts");
  // CP-6: the maintenance entry appears only while assigned.
  const maintenance = useMaintenanceSection();
  const waitingAsks = useOpenAskCount();

  const nav = React.useMemo<NavItem[]>(() => {
    const tabBadges = cleanerTabBadges({ attention, maintenanceCount: maintenance.count, waitingAsks });
    const tabHrefs = new Set(CLEANER_TABS.map((tab) => tab.href));
    const tabFor = (href: string) => CLEANER_TABS.find((tab) => tab.href === href);

    const rail: NavItem[] = CLEANER_RAIL.map((item) => {
      const tab = tabFor(item.href);
      const base: NavItem = { href: item.href, label: item.label, icon: item.icon, group: item.group };
      // The Pay tab is a registered tour target (cleaner.today tour, step 4).
      if (item.href === "/v2/cleaner/pay") base.tour = tourTarget("cleaner.tabs.pay");
      if (tab) {
        // Tab entries carry the tab's sub-paths and the tab's combined badge.
        return withBadge({ ...base, tabActivePrefixes: tab.activePrefixes }, tabBadges[item.href]);
      }
      return withBadge(base, attention[item.href]);
    });
    if (maintenance.assigned) {
      rail.push(withBadge({ ...CLEANER_MAINTENANCE_RAIL_ITEM }, maintenance.count));
    }
    // Tabs without a rail entry (More) exist for the phone only.
    const phoneOnly: NavItem[] = CLEANER_TABS.filter((tab) => !rail.some((item) => item.href === tab.href))
      .filter((tab) => tabHrefs.has(tab.href))
      .map((tab) => withBadge(
        { href: tab.href, label: tab.label, icon: tab.icon, mobileOnly: true, tabActivePrefixes: tab.activePrefixes },
        tabBadges[tab.href],
      ));
    return [...rail, ...phoneOnly];
  }, [attention, maintenance.assigned, maintenance.count, waitingAsks]);

  return (
    <div data-skin="estate" data-portal-accent="cleaner">
      <PortalShell
        accent="cleaner"
        wordmark="sNeek"
        nav={nav}
        roleLabel="Cleaner"
        immersive={isCleanerJobScreen}
        hideMobileMenuButton
      >
        <LocationTracker />
        {children}
      </PortalShell>
    </div>
  );
}
