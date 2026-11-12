"use client";

import * as React from "react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { useAttentionCounts } from "@/components/v2/portal/use-attention-counts";
import { useMaintenanceSection } from "@/components/v2/portal/use-maintenance-section";
import { buildTabbedNav } from "@/lib/navigation/tabbed-nav";
import { QA_MAINTENANCE_RAIL_ITEM, QA_RAIL, QA_TABS } from "@/components/v2/qa/portal/qa-nav";

/**
 * QA portal shell (approved board "QA portal", 2026-11).
 *
 * Phone: five tabs — Today, Reviews, Rework, Pay, More. The More tab is the
 * labelled, role-filtered menu (Stats, Invoices, Maintenance while assigned,
 * Profile, account), so the phone header carries only search and
 * notifications. The inspection screen keeps the tab bar, as drawn.
 *
 * Desktop: the rail lists every destination, unchanged in reach.
 */
export default function V2QaLayout({ children }: { children: React.ReactNode }) {
  // CP-6: the maintenance entry exists only while this inspector is assigned.
  const maintenance = useMaintenanceSection();
  // Queue badges from real counts; a failed poll keeps the last counts.
  const counts = useAttentionCounts("/api/qa/attention-counts");

  const nav = React.useMemo<NavItem[]>(
    () =>
      buildTabbedNav({
        rail: QA_RAIL,
        tabs: QA_TABS,
        extra: maintenance.assigned ? [QA_MAINTENANCE_RAIL_ITEM] : [],
        // On a phone the maintenance entry lives in More, so More carries its count.
        badges: {
          ...counts,
          [QA_MAINTENANCE_RAIL_ITEM.href]: maintenance.count,
          "/v2/qa/more": maintenance.assigned ? maintenance.count : 0,
        },
      }),
    [counts, maintenance.assigned, maintenance.count],
  );

  return (
    <div data-skin="estate" data-portal-accent="qa">
      <PortalShell accent="qa" wordmark="sNeek" nav={nav} roleLabel="QA" hideMobileMenuButton>
        {children}
      </PortalShell>
    </div>
  );
}
